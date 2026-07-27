// Dashboard Error Tracking Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.errors = {
    fetchErrors: async function() {
        try {
            const response = await window.Dashboard.api.request('/api/errors');
            const errors = await response.json();
            const tableBody = document.getElementById('errors-table-body');
            if (!tableBody) return;

            if (errors.length > 0) {
                tableBody.innerHTML = errors.map(err => `
                    <tr class="border-b border-slate-100 font-inter text-[10px]">
                        <td class="p-4 text-slate-400 tracking-tighter uppercase">${err.date} <br> ${err.time}</td>
                        <td class="p-4 font-bold text-slate-700 uppercase">${window.Dashboard.utils.escapeHTML(err.type)}</td>
                        <td class="p-4 text-red-500 font-mono tracking-tighter max-w-xs break-words">${window.Dashboard.utils.escapeHTML(err.message)}</td>
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded-full font-bold ${err.solved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">
                                ${err.solved ? 'RESOLVED' : 'PENDING'}
                            </span>
                        </td>
                        <td class="p-4 text-center">
                            ${err.solved ? '-' : `<button onclick="solveError(${err.id})" class="text-blue-600 font-bold uppercase hover:underline">Mark Solved</button>`}
                        </td>
                    </tr>
                `).join('');
            } else {
                tableBody.innerHTML = '<tr><td colspan="5" class="p-12 text-center text-slate-400 uppercase text-[10px] tracking-widest">No Incidents Reported. System stable.</td></tr>';
            }
        } catch (err) {
            console.error(err);
        }
    },

    solveError: async function(id) {
        try {
            const response = await window.Dashboard.api.request('/api/errors/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const result = await response.json();
            if (result.success) {
                window.Dashboard.errors.fetchErrors();
                window.Dashboard.analytics.fetchStatsAndUsers();
            }
        } catch (err) {
            alert('فشل تحديث حالة المشكلة.');
        }
    }
};

// Bind to global namespace for inline compatibility
window.fetchErrors = window.Dashboard.errors.fetchErrors;
window.solveError = window.Dashboard.errors.solveError;
