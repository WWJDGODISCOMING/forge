#!/usr/bin/env bash
# Forge "Deploy" button: one-time Google Cloud setup. Keyless (no key file is ever created). Safe to re-run.
# Run:  curl -fsSL https://raw.githubusercontent.com/WWJDGODISCOMING/forge/main/scripts/deploy-setup.sh | bash
# New secret names can be added on the end:  ... | bash -s -- NEW_SECRET_NAME
# Everything runs inside main(), which is only called on the last line. So a cut-off download runs nothing,
# and no command can read the rest of the script from the pipe.
set -euo pipefail

main() {
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
PROJECT=forge-web-f2351
REGION=us-east1
REPO_ID=1409700573   # github.com/WWJDGODISCOMING/forge
OWNER_ID=259723992   # GitHub user WWJDGODISCOMING
WORKFLOW_REF="WWJDGODISCOMING/forge/.github/workflows/deploy.yml@refs/heads/main"
POOL=github
PROVIDER=forge-deploy
SA_NAME=forge-deployer
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
ROLE_ID=forgeDeployExtras
SECRETS="WITHINGS_CLIENT_SECRET WITHINGS_WEBHOOK_KEY USDA_API_KEY XAI_API_KEY"
for EXTRA in "$@"; do
  if ! [[ "$EXTRA" =~ ^[A-Za-z0-9_-]{1,255}$ ]]; then
    echo "Not a secret name: $EXTRA (letters, digits, _ and - only)" >&2; exit 1
  fi
  SECRETS="$SECRETS $EXTRA"
done
retry() { for _ in 1 2 3 4 5 6; do "$@" >/dev/null 2>&1 && return 0; sleep 10; done; "$@" >/dev/null; }

gcloud config set project "$PROJECT" >/dev/null 2>&1
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUNTIME_SA="${NUM}-compute@developer.gserviceaccount.com"
LEGACY_SA="${PROJECT}@appspot.gserviceaccount.com"
POOL_NAME="projects/${NUM}/locations/global/workloadIdentityPools/${POOL}"

echo "1/6 Turning on the APIs the deploy uses (can take a minute)..."
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com firebase.googleapis.com \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com cloudtasks.googleapis.com secretmanager.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com storage.googleapis.com \
  firebaserules.googleapis.com firestore.googleapis.com >/dev/null

echo "2/6 The deploy robot account (no key)..."
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="Forge Deploy button (GitHub, keyless)" >/dev/null
retry gcloud iam service-accounts describe "$SA"

echo "3/6 A small custom role for two permissions no narrow built-in role has..."
PERMS=firebase.projects.get,serviceusage.services.generateServiceIdentity
if gcloud iam roles describe "$ROLE_ID" --project="$PROJECT" >/dev/null 2>&1; then
  if [ "$(gcloud iam roles describe "$ROLE_ID" --project="$PROJECT" --format='value(deleted)')" = "True" ]; then
    gcloud iam roles undelete "$ROLE_ID" --project="$PROJECT" >/dev/null
  fi
  gcloud iam roles update "$ROLE_ID" --project="$PROJECT" --permissions="$PERMS" --stage=GA >/dev/null
else
  gcloud iam roles create "$ROLE_ID" --project="$PROJECT" --title="Forge deploy extras" \
    --description="Read the Firebase project config; create the Pub/Sub and Eventarc service identities." \
    --permissions="$PERMS" --stage=GA >/dev/null
fi

echo "4/6 Granting only what firebase deploy needs..."
for ROLE in roles/cloudfunctions.admin roles/run.admin roles/artifactregistry.reader \
    roles/cloudscheduler.admin roles/cloudtasks.queueAdmin roles/secretmanager.viewer \
    roles/firebaserules.admin roles/datastore.indexAdmin roles/serviceusage.serviceUsageConsumer \
    "projects/${PROJECT}/roles/${ROLE_ID}"; do
  retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA}" --role="$ROLE" --condition=None
done
retry gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${SA}" --role=roles/iam.serviceAccountUser --condition=None
if gcloud iam service-accounts describe "$LEGACY_SA" >/dev/null 2>&1; then
  retry gcloud iam service-accounts add-iam-policy-binding "$LEGACY_SA" \
    --member="serviceAccount:${SA}" --role=roles/iam.serviceAccountUser --condition=None
fi
# The functions (not the robot) read the secrets. Granting that here means the robot never needs to change secret permissions.
for S in $SECRETS; do
  if gcloud secrets describe "$S" >/dev/null 2>&1; then
    retry gcloud secrets add-iam-policy-binding "$S" \
      --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --condition=None
  fi
done

echo "5/6 Keyless sign-in from GitHub, for this repo, its owner and the main-branch deploy.yml only..."
if gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  if [ "$(gcloud iam workload-identity-pools describe "$POOL" --location=global --format='value(state)')" = "DELETED" ]; then
    gcloud iam workload-identity-pools undelete "$POOL" --location=global >/dev/null
  fi
else
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" >/dev/null
fi
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.actor_id=assertion.actor_id,attribute.workflow_ref=assertion.workflow_ref,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name"
CONDITION="assertion.repository_id=='${REPO_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.actor_id=='${OWNER_ID}' && assertion.event_name=='workflow_dispatch' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='${WORKFLOW_REF}'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global >/dev/null 2>&1; then
  if [ "$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --format='value(state)')" = "DELETED" ]; then
    gcloud iam workload-identity-pools providers undelete "$PROVIDER" --workload-identity-pool="$POOL" --location=global >/dev/null
  fi
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global \
    --display-name="Forge deploy.yml" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" >/dev/null
fi
retry gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository_id/${REPO_ID}" --condition=None

echo "6/6 Old build images: auto-delete after 1 day (only if no cleanup rule is set yet)..."
if REPO_JSON=$(gcloud artifacts repositories describe gcf-artifacts --location="$REGION" --format=json 2>/dev/null); then
  if echo "$REPO_JSON" | jq -e '((.cleanupPolicies // {}) | length) == 0 and ((.labels // {})["firebase-functions-cleanup-opted-out"] != "true")' >/dev/null; then
    echo '[{"name":"firebase-functions-cleanup","action":{"type":"Delete"},"condition":{"tagState":"any","olderThan":"1d"}}]' > /tmp/forge-cleanup.json
    gcloud artifacts repositories set-cleanup-policies gcf-artifacts --location="$REGION" --policy=/tmp/forge-cleanup.json --no-dry-run >/dev/null
  fi
fi

echo
echo "All set. Add these two GitHub Actions VARIABLES (they are not secrets):"
echo
echo "GCP_WIF_PROVIDER"
echo "${POOL_NAME}/providers/${PROVIDER}"
echo
echo "GCP_DEPLOY_SA"
echo "${SA}"
}

main "$@"
