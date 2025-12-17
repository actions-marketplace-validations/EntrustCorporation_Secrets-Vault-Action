const core = require('@actions/core');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createAuthenticator } = require('./auth');
const {BASE_URL, CA_CERT, TLS_VERIFY_SKIP, SECRETS} =  require('./constants.js');

const checkoutSecretAPI = "/vault/1.0/CheckoutSecret/"

async function exportSecrets() {
  let tempCertPath = null;
  
  try {
    let baseUrl = core.getInput(BASE_URL, { required: true });

    if (!baseUrl) {
      core.error('Base URL is required');
      throw new Error('Base URL is required');
    }
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
      core.info(`Base URL adjusted to remove trailing slash: ${baseUrl}`);
    }

    const caCert = core.getInput(CA_CERT);
    const secretsInput = core.getInput(SECRETS, { required: true });
    const tls_verify_skip = core.getBooleanInput(TLS_VERIFY_SKIP);

    core.info(`Parsing secrets: ${secretsInput}`);

    let httpAgentConfig = {

    }

    if (caCert) {
      core.info('Using provided CA certificate for self-signed certificate support');
      
      // Decode base64 certificate and write to temp file
      const certBuffer = Buffer.from(caCert, 'base64');
      tempCertPath = path.join(os.tmpdir(), `ca-cert-${Date.now()}.pem`);
      fs.writeFileSync(tempCertPath, certBuffer);
      core.info(`CA certificate written to temporary file: ${tempCertPath}`);
      
      httpAgentConfig['ca'] =  fs.readFileSync(tempCertPath)
    } else {
      core.info('No CA certificate provided, using default certificate validation');
    }

    if (tls_verify_skip === true || tls_verify_skip === 'true') {
      httpAgentConfig['rejectUnauthorized'] = false;
      core.info('Skipping TLS verification, we recommend not to use this in production');
    }

    const httpsAgent = new https.Agent(httpAgentConfig);

    // Initialize the authenticator
    const authenticator = createAuthenticator({
      baseUrl,
      httpsAgent,
      timeout: 10000
    });

    // Parse secrets from input
    for (const { secretType, boxID, secretID, destination } of parseSecrets(secretsInput)) {
      core.debug(`Processing secret: ${secretID} from box: ${boxID} to destination: ${destination}`);
      if (secretType === 'p12') {
        core.info(`Detected p12 secret type for: ${secretID}`);
        throw new Error(`Detected p12 secret type for: ${secretID}, p12 secrets are not supported yet`);
      } else {
        core.info(`Fetching secret: ${secretID} from box: ${boxID}`);
        const secretValue = await fetchSecretFromVault(boxID, secretID, authenticator, baseUrl, httpsAgent);
        core.setSecret(secretValue);
        core.exportVariable(destination, secretValue);
        core.setOutput(destination, secretValue);
      }
    }
  } catch (error) {
    core.setFailed(error.message);
    throw error; // Re-throw for testing purposes
  } finally {
    // Clean up temp file if it was created
    if (tempCertPath && fs.existsSync(tempCertPath)) {
      try {
        fs.unlinkSync(tempCertPath);
        core.info('Temporary CA certificate file cleaned up');
      } catch (err) {
        core.error(`Failed to clean up temporary certificate file: ${err.message}`);
      }
    }
  }
}

// Minimal parser for "BoxName.SecretName: ENV_VAR_NAME"
function *parseSecrets(secretsStr) {
  const entries = secretsStr.split(';');
  core.info(`Identified ${entries.length} entries in secrets input`);
  for (const entry of entries) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue;
    
    const [key, val] = trimmedEntry.split('|').map(s => s.trim());
    const parts = key.trim().split('.');
    if (parts.length === 2) {
      const [boxID, secretID] = parts;
      yield { boxID, secretID, destination: val.trim() };
    } else {
      core.error(`Invalid entry format: ${entry}`);
      throw new Error(`Invalid secret entry format: ${entry}. Expected format: BoxName.SecretName | ENV_VAR_NAME`);
    }
  }
}

async function fetchSecretFromVault(boxID, secretID, authenticator, baseUrl, httpsAgent) {
  try {
    const authHeaders = await authenticator.getAuthHeaders();
    const config = { headers: authHeaders, httpsAgent, timeout: 10000 };
    const response = await axios.post(
      `${baseUrl}${checkoutSecretAPI}`,
      { box_id: boxID, secret_id: secretID },
      config
    );
    if (!response.data) {
      core.error(`Empty response received from API for boxID: ${boxID}, secretID: ${secretID}`);
      throw new Error('Empty response received from API');
    }
    const secretValue = response.data.secret_data;
    if (!secretValue) {
      core.error(`Secret data not found in response: ${JSON.stringify(response.data)}`);
      throw new Error(`Secret data not found in response: ${JSON.stringify(response.data)}`);
    }
    return secretValue;
  } catch (error) {
    core.error(`Error fetching secret for boxID: ${boxID}, secretID: ${secretID} - ${error.message}`);
    throw new Error(`Failed to fetch secret: ${error.message}`);
  }
}

module.exports = { exportSecrets, fetchSecretFromVault };
