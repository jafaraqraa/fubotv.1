const { validateProviderModelCombination } = require('./aiProviders');

const SUPPORTED_PROVIDERS = new Set(['openrouter', 'openai', 'gemini', 'ollama']);

function validateCustomModelsPayload(value) {
    let parsed;
    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch (_) {
        throw new Error('بيانات الموديلات المخصصة ليست JSON صالحاً.');
    }

    const models = Array.isArray(parsed) ? parsed : parsed?.models;
    if (!Array.isArray(models)) throw new Error('قائمة الموديلات المخصصة غير صالحة.');
    if (models.length > 200) throw new Error('تم تجاوز الحد الأقصى للموديلات المخصصة.');

    const seen = new Set();
    const normalized = models.map(model => {
        const provider = String(model?.provider || '').toLowerCase().trim();
        const name = String(model?.name || '').trim();
        const id = String(model?.id || '').trim();
        if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error(`مزود غير مدعوم: ${provider || 'فارغ'}.`);
        if (name.length < 2 || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) {
            throw new Error('اسم عرض الموديل يجب أن يكون بين حرفين و80 حرفاً ومن دون رموز HTML.');
        }
        if (!id || id.length > 160 || !/^[A-Za-z0-9._:/-]+$/.test(id)) {
            throw new Error(`معرّف الموديل غير صالح: ${id || 'فارغ'}.`);
        }
        validateProviderModelCombination(provider, id);
        const key = `${provider}\u0000${id.toLowerCase()}`;
        if (seen.has(key)) throw new Error(`الموديل ${id} مكرر للمزوّد ${provider}.`);
        seen.add(key);
        return { provider, name, id };
    });

    return JSON.stringify({
        updatedAt: Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : Date.now(),
        models: normalized
    });
}

module.exports = { validateCustomModelsPayload };
