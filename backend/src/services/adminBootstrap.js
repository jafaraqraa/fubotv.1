const bcrypt = require('bcryptjs');
const { anyAdminExists, createAdmin } = require('../database/repositories/adminRepository');

function bootstrapAdminAccount() {
    try {
        if (!anyAdminExists()) {
            console.log('🌱 No administrator account found. Bootstrapping initial administrator account...');

            const defaultUser = 'admin';
            const defaultPassword = 'Admin@123456';

            const hash = bcrypt.hashSync(defaultPassword, 10);
            createAdmin(defaultUser, hash, 'Administrator');

            console.log('✅ Successfully created initial administrator account!');
            console.log('⚠️  WARNING: It is highly recommended to change the default password after your first successful login.');
        } else {
            console.log('👤 Existing administrator accounts verified. Bypassing account bootstrap.');
        }
    } catch (err) {
        console.error('❌ Failed to bootstrap initial administrator account:', err.message);
    }
}

module.exports = {
    bootstrapAdminAccount
};
