// Dashboard Error Tracking Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.errors = {
    friendlyError: function(error) {
        const type = String(error?.type || '').toUpperCase();
        const message = String(error?.message || '');
        if (type.includes('STARTUP') || /EADDRINUSE/i.test(message)) {
            return {
                title: 'تعذر تشغيل إحدى خدمات النظام',
                description: /EADDRINUSE/i.test(message)
                    ? 'المنفذ المطلوب مستخدم من خدمة أخرى.'
                    : 'تعذر بدء الخدمة المطلوبة، وتحتاج إلى مراجعة.'
            };
        }
        if (type.includes('OPENROUTER') || type.includes('PROVIDER') || /API key/i.test(message)) {
            return {
                title: 'تعذر الاتصال بمزود الذكاء الاصطناعي',
                description: /expired|invalid|key/i.test(message)
                    ? 'بيانات الاتصال بالمزود تحتاج إلى تحديث.'
                    : 'المزود غير متاح حاليًا أو لم يستجب للطلب.'
            };
        }
        if (/timeout|timed out/i.test(message)) {
            return { title: 'تأخرت استجابة إحدى الخدمات', description: 'لم تصل استجابة ضمن الوقت المتوقع.' };
        }
        return { title: 'حدث عطل يحتاج إلى المراجعة', description: 'راجع التفاصيل التقنية لمعرفة سبب العطل.' };
    },

    fetchErrors: async function() {
        const tableBody = document.getElementById('errors-table-body');
        if (tableBody) {
            const loadingRow = document.createElement('tr');
            loadingRow.appendChild(window.Dashboard.utils.createElement('td', {
                className: 'p-10 text-center text-slate-500 text-xs',
                text: 'جاري تحميل سجل الأعطال…',
                attributes: { colspan: '5', role: 'status' }
            }));
            tableBody.replaceChildren(loadingRow);
        }
        try {
            const response = await window.Dashboard.api.request('/api/errors');
            if (!response.ok) throw new Error('تعذر تحميل سجل الأعطال.');
            const errors = await response.json();
            if (!tableBody) return;

            const dom = window.Dashboard.utils;
            const rows = errors.map(err => {
                const friendly = this.friendlyError(err);
                const row = dom.createElement('tr', { className: 'border-b border-slate-100 font-inter text-[12px]' });
                const timestamp = dom.createElement('td', {
                    className: 'p-4 text-slate-400 tracking-tighter uppercase'
                });
                timestamp.append(
                    document.createTextNode(String(err.date || '')),
                    document.createElement('br'),
                    document.createTextNode(String(err.time || ''))
                );
                const statusCell = dom.createElement('td', { className: 'p-4' });
                statusCell.appendChild(dom.createElement('span', {
                    className: `px-2 py-0.5 rounded-full font-bold ${err.solved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-700'}`,
                    text: err.solved ? 'تم الحل' : 'بحاجة للمتابعة'
                }));
                const actionCell = dom.createElement('td', { className: 'p-4 text-center' });
                if (err.solved) {
                    actionCell.textContent = '-';
                } else {
                    const button = dom.createElement('button', {
                        className: 'text-blue-600 font-bold uppercase hover:underline',
                        text: 'تحديد كمحلول'
                    });
                    button.type = 'button';
                    button.addEventListener('click', () => window.Dashboard.errors.solveError(err.id));
                    actionCell.appendChild(button);
                }
                const messageCell = dom.createElement('td', { className: 'p-4 text-red-500 font-mono tracking-tighter max-w-xs break-words' });
                messageCell.appendChild(dom.createElement('span', {
                    className: 'error-desktop-message',
                    text: err.message
                }));
                const mobilePresentation = dom.createElement('div', { className: 'error-mobile-presentation' });
                const technicalDetails = dom.createElement('details', { className: 'error-technical-details' });
                technicalDetails.append(
                    dom.createElement('summary', { text: 'عرض التفاصيل التقنية' }),
                    dom.createElement('code', { text: `${err.type || 'ERROR'}\n${err.message || ''}` })
                );
                mobilePresentation.append(
                    dom.createElement('strong', { text: friendly.title }),
                    dom.createElement('p', { text: friendly.description }),
                    technicalDetails
                );
                messageCell.appendChild(mobilePresentation);
                row.append(
                    timestamp,
                    dom.createElement('td', { className: 'p-4 font-bold text-slate-700 uppercase', text: err.type }),
                    messageCell,
                    statusCell,
                    actionCell
                );
                return row;
            });
            if (rows.length === 0) {
                const row = document.createElement('tr');
                row.appendChild(dom.createElement('td', {
                    className: 'p-12 text-center text-slate-400 uppercase text-[12px] tracking-widest',
                    text: 'لا توجد أعطال مسجلة. النظام مستقر.',
                    attributes: { colspan: '5' }
                }));
                rows.push(row);
            }
            tableBody.replaceChildren(...rows);
        } catch (err) {
            console.error(err);
            if (tableBody) {
                const row = document.createElement('tr');
                row.appendChild(window.Dashboard.utils.createElement('td', {
                    className: 'p-10 text-center text-red-600 text-xs',
                    text: window.Dashboard.utils.userFacingError(err, 'تعذر تحميل سجل الأعطال. حاول مرة أخرى.'),
                    attributes: { colspan: '5', role: 'alert' }
                }));
                tableBody.replaceChildren(row);
            }
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
                window.Dashboard.settings.showToast('تم تحديث حالة العطل.');
            } else {
                throw new Error(result.error || 'تعذر تحديث حالة العطل.');
            }
        } catch (err) {
            window.Dashboard.settings.showToast(
                window.Dashboard.utils.userFacingError(err, 'تعذر تحديث حالة العطل.'),
                'error'
            );
        }
    }
};

// Bind to global namespace for inline compatibility
window.fetchErrors = window.Dashboard.errors.fetchErrors;
window.solveError = window.Dashboard.errors.solveError;
