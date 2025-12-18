# Secret Vault Action With Gitea Trial Guide

This guide explains how to evaluate the Entrust Secrets Vault Action with username and password authentication. It includes two ready-to-run GitHub Actions workflows: a lightweight echo example that confirms vault access and a SonarQube workflow that uses the retrieved secret in a real analysis pipeline.

## 1. Prerequisites

### 1.1 Vault Setup

- Entrust KeyControl vault reachable over HTTPS.
- Vault box named **Box1** containing the following password-type secrets:
	- **PassSecret** for the echo workflow.
	- **SonarToken** for the SonarQube workflow.
- Vault user represented by `VAULT_USERNAME` holds checkout permission or an equivalent role for these Box1 secrets.

### 1.2 Repository Secrets in Gitea

Create the repository secrets listed below before running either workflow.

| Gitea Secret | Purpose |
|--------------|---------|
| VAULT_URL | Base HTTPS endpoint for the Entrust KeyControl API. (e.g., https://vault.example.com) |
| VAULT_USERNAME | Vault account with read access to Box1. |
| VAULT_PASSWORD | Password for the above account. |
| VAULT_ID | Vault UID associated with the account. |
| VAULT_CA_CERT | Optional base64-encoded CA bundle when using Self Signed Certificate. |
| SONAR_HOST_URL | SonarQube server URL for the analysis workflow. |

Ensure that stored values match the vault configuration exactly; secret names are case-sensitive.

## 2. Example Workflow: Fetch and Echo a Secret

The following workflow retrieves Box1.PassSecret, makes it available as `EXAMPLE_SECRET`, and echoes a masked value. Save the file as `.gitea/workflows/echo-secret.yml` to run the scenario.

```yaml
name: Deploy Application

on:
	push:
		branches: [ main ]
	pull_request:
		branches: [ main ]

jobs:
	deploy:
		runs-on: ubuntu-latest
		steps:
			- name: Checkout code
				uses: actions/checkout@v3

			- name: Fetch secrets from vault
				id: fetch-secrets
				uses: EntrustCorporation/secrets-vault-action@v1.0.1
				with:
					base_url: ${{ secrets.VAULT_URL }}
					auth_type: 'userpass'
					username: ${{ secrets.VAULT_USERNAME }}
					password: ${{ secrets.VAULT_PASSWORD }}
					vault_uid: ${{ secrets.VAULT_ID }}
					tls_verify_skip: true
					secrets: |
						Box1.PassSecret | EXAMPLE_SECRET;

			- name: Echo fetched secret
				run: |
					echo "Vault action returned a secret that is masked in logs."
					echo "Masked value: $EXAMPLE_SECRET"
```

Verification checklist:
- The vault step finishes successfully and exposes both the environment variable and the action output `steps.fetch-secrets.outputs.EXAMPLE_SECRET`.
- Workflow logs show masked output instead of the plain secret value.
- Set `tls_verify_skip` to `false` once the vault certificate chain is trusted or when `VAULT_CA_CERT` is supplied.

## 3. Example Workflow: SonarQube Analysis with Vault Secret

This workflow retrieves Box1.SonarToken and passes it to the SonarQube scanner. Save it as `.gitea/workflows/sonarqube.yml` and adjust script steps to match the repository layout.

```yaml
name: JS Code Quality
on:
	push:
		branches: [main]

jobs:
	analyze:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
				with:
					fetch-depth: 0

			- name: Fetch secrets from vault
				id: fetch-secrets
				uses: EntrustCorporation/secrets-vault-action@main
				with:
					base_url: ${{ secrets.VAULT_URL }}
					auth_type: 'userpass'
					username: ${{ secrets.VAULT_USERNAME }}
					password: ${{ secrets.VAULT_PASSWORD }}
					vault_uid: ${{ secrets.VAULT_ID }}
					ca_cert: ${{ secrets.VAULT_CA_CERT }}
					tls_verify_skip: true
					secrets: |
						Box1.SonarToken | SONAR_TOKEN;

			- name: Setup Node.js
				uses: actions/setup-node@v4
				with:
					node-version: 18

			- name: Install Dependencies
				run: npm install

			- name: Run Tests with Coverage
				run: npm test -- --coverage

			- name: SonarQube Scan
				uses: sonarsource/sonarqube-scan-action@v6
				env:
					SONAR_TOKEN: ${{ env.SONAR_TOKEN }}
					SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

Validation checklist:
- The vault step surfaces `SONAR_TOKEN` for subsequent steps.
- Dependency installation and test coverage complete successfully, providing input for the scanner.
- The SonarQube scan reports success without prompting for credentials.
- Remove or set `tls_verify_skip` to `false` after confirming TLS trust, relying on `VAULT_CA_CERT` when necessary.

## 4. Troubleshooting Guidance

- **Connectivity**: Add a temporary `curl -I ${{ secrets.VAULT_URL }}` step if the runner cannot reach the vault host.
- **Authentication failures**: Confirm the stored username, password, and vault UID match the credentials configured in Entrust KeyControl.
- **Secret resolution**: Ensure box and secret names mirror the vault configuration; they are case-sensitive.
- **SonarQube authorization**: Verify the SonarQube token permissions and refresh the Box1 secret if scans return HTTP 401.


## 5. Additional Resources

For extended configuration options, security considerations, and troubleshooting tips, refer to the official documentation: https://github.com/EntrustCorporation/Secrets-Vault-Action

