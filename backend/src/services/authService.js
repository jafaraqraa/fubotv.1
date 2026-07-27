const bcrypt = require('bcryptjs');
const adminRepo = require('../database/repositories/adminRepository');

function authenticate(username, password) {
    if (!username || !password) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    const cleanUser = String(username).trim().toLowerCase();
    const admin = adminRepo.findAdminByUsername(cleanUser);

    if (!admin || !admin.isActive) {
        // Slow down slightly to prevent timing attacks
        bcrypt.compareSync('dummy_password', '$2a$10$dummyhashplaceholderxxxxxxx');
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    const valid = bcrypt.compareSync(password, admin.passwordHash);
    if (!valid) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    // Success! Update last successful login
    adminRepo.updateLastLogin(admin.id);

    return {
        success: true,
        user: {
            id: admin.id,
            username: admin.username,
            displayName: admin.displayName
        }
    };
}

module.exports = {
    authenticate
};
