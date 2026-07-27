const { registerCustomerUser } = require('../database/repositories/customerRepository');

function registerUser(userId, name, platform) {
    registerCustomerUser(userId, name, platform);
}

module.exports = {
    registerUser
};
