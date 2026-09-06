'use strict';

const { ClaimVerifierProvider } = require('./contracts');
const { verifyClaims } = require('../verification/claimVerifier');

class DeterministicClaimVerifierProvider extends ClaimVerifierProvider {
    async verifyClaims({ response, selected }) { return verifyClaims(response, selected); }
}

module.exports = { DeterministicClaimVerifierProvider };
