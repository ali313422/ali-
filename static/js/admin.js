(function () {
  const userForm = document.getElementById('user-form');
  const accountForm = document.getElementById('account-form');
  const adminForm = document.getElementById('admin-form');
  const smtpForm = document.getElementById('smtp-form');
  const settingsForm = document.getElementById('settings-form');
  const adminsBody = document.getElementById('admins-table-body');
  const ministrySelect = document.getElementById('ministry-select');
  const usersBody = document.getElementById('users-table-body') || document.querySelector('#users-table tbody');
  const pageFlash = document.getElementById('page-flash');

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function flash(el, text, ok) {
    const target = el || pageFlash;
    if (!target) return;
    target.textContent = text || '';
    target.classList.toggle('ok', Boolean(ok));
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json' };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || `فشل الطلب (${response.status})`);
    }
    return data;
  }

  function statusPill(sub) {
    if (!sub) return '<span class="status-pill bad">بدون اشتراك</span>';
    if (sub.active) return '<span class="status-pill ok">فعّال</span>';
    if (sub.pending) return '<span class="status-pill wait">لم يبدأ</span>';
    if (sub.expired) return '<span class="status-pill bad">منتهي</span>';
    return '<span class="status-pill bad">غير فعّال</span>';
  }

  function defaultEndDate() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }

  /** YYYY-MM-DD لحقول date (يدعم 2026-05-28 أو 2026-05-28T00:00:00) */
  function toDateInput(value) {
    if (!value) return '';
    const text = String(value).trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysIso(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function applySubscriptionPreset(panel, days) {
    if (!panel || days < 1) return;
    const startInput = panel.querySelector('[name="starts_at"]');
    const endInput = panel.querySelector('[name="ends_at"]');
    if (!startInput || !endInput) return;
    const start = todayIso();
    const end = addDaysIso(start, days - 1);
    startInput.value = start;
    endInput.value = end;
  }

  function renderUsageLabel(sub) {
    if (!sub) return '—';
    if (sub.render_unlimited) return 'غير محدود';
    const used = sub.render_used ?? 0;
    const limit = sub.render_limit ?? 20;
    return `${used} / ${limit}`;
  }

  function setDefaultDates() {
    const today = new Date().toISOString().slice(0, 10);
    if (userForm?.starts_at) userForm.starts_at.value = today;
    if (userForm?.ends_at) userForm.ends_at.value = defaultEndDate();
  }

  function fillMinistries(ministries) {
    if (!ministrySelect) return;
    const active = (ministries || []).filter((m) => m.is_active);
    if (!active.length) {
      ministrySelect.innerHTML = '<option value="">لا توجد جهة</option>';
      return;
    }
    ministrySelect.innerHTML = active
      .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
      .join('');
  }

  function closeAllPanels() {
    usersBody.querySelectorAll('.edit-form').forEach((el) => el.classList.remove('open'));
  }

  function togglePanel(prefix, id, btn) {
    const panel = document.getElementById(`${prefix}-${id}`);
    const isOpen = panel?.classList.contains('open');
    closeAllPanels();
    if (!isOpen) panel?.classList.add('open');
  }

  function fillUsers(users) {
    if (!users.length) {
      usersBody.innerHTML =
        '<tr><td colspan="6" class="muted">لا يوجد مشتركون بعد — أضف أول مشترك من النموذج على اليسار.</td></tr>';
      return;
    }

    usersBody.innerHTML = users
      .map((u) => {
        const sub = u.subscription || {};
        const starts = toDateInput(sub.starts_at) || new Date().toISOString().slice(0, 10);
        const ends = toDateInput(sub.ends_at) || defaultEndDate();
        const renderLimit = sub.render_limit ?? 20;
        return `<tr data-id="${u.id}" data-server-user="1">
          <td>
            <strong>${esc(u.display_name)}</strong><br>
            <small class="muted">${esc(u.username)}</small>
            ${u.phone ? `<br><small class="muted">📱 ${esc(u.phone)}</small>` : '<br><small class="muted" style="color:#fca5a5">بدون موبايل</small>'}
            ${u.ministry_name ? `<br><small class="muted">${esc(u.ministry_name)}</small>` : ''}
          </td>
          <td>${esc(toDateInput(sub.starts_at) || '—')}</td>
          <td>${esc(toDateInput(sub.ends_at) || '—')}</td>
          <td>${renderUsageLabel(sub)}</td>
          <td>${statusPill(sub)}</td>
          <td>
            <div class="action-btns">
              <button type="button" class="btn primary btn-edit-toggle" data-id="${u.id}">تعديل</button>
              <a class="btn danger" href="/admin/delete/${u.id}"
                onclick="return confirm(${JSON.stringify(`حذف ${u.username} نهائياً؟`)});">حذف</a>
            </div>
            <div class="edit-form" id="edit-${u.id}">
              <p class="edit-form-title">تعديل المشترك</p>
              <div class="form-row">
                <label><span>اسم الدخول (يوزر)</span><input name="username" value="${esc(u.username)}" autocomplete="off"></label>
                <label><span>الاسم المعروض</span><input name="display_name" value="${esc(u.display_name)}"></label>
              </div>
              <label><span>كلمة مرور جديدة</span><input name="password" type="password" placeholder="اتركها فارغة إن لم تُرد التغيير" autocomplete="new-password"></label>
              <label><span>موبايل واتساب</span><input name="phone" type="tel" value="${esc(u.phone || '')}" placeholder="07xxxxxxxx"></label>
              <label><span>بريد Gmail</span><input name="email" type="email" value="${esc(u.email || '')}" placeholder="user@gmail.com"></label>
              <p class="muted" style="margin:0;font-size:0.82rem">مدة سريعة:</p>
              <div class="subscription-presets">
                <button type="button" class="btn ghost btn-preset" data-days="1">يوم واحد</button>
                <button type="button" class="btn ghost btn-preset" data-days="7">7 أيام</button>
                <button type="button" class="btn ghost btn-preset" data-days="30">30 يوم</button>
                <button type="button" class="btn ghost btn-preset" data-days="365">سنة</button>
              </div>
              <div class="renew-row">
                <label><span>بداية الاشتراك</span><input type="date" name="starts_at" value="${starts}" required></label>
                <label><span>نهاية الاشتراك</span><input type="date" name="ends_at" value="${ends}" required></label>
              </div>
              <label><span>حد الرندر (العدد)</span><input type="number" name="render_limit" min="0" value="${renderLimit}"></label>
              <label><span><input type="checkbox" name="reset_render_used"> تصفير عداد الرندر المستخدم</span></label>
              <button type="button" class="btn primary btn-edit-save" data-id="${u.id}">حفظ كل التعديلات</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    bindUserRowEvents();
  }

  function bindUserRowEvents() {
    /* الأحداث تُربط مرة واحدة عبر التفويض — refresh يعيد بناء الصفوف فقط */
  }

  if (usersBody && !usersBody.dataset.editBound) {
    usersBody.dataset.editBound = '1';
    usersBody.addEventListener('click', async (event) => {
      const toggleBtn = event.target.closest('.btn-edit-toggle');
      if (toggleBtn) {
        togglePanel('edit', toggleBtn.getAttribute('data-id'));
        return;
      }
      const presetBtn = event.target.closest('.btn-preset');
      if (presetBtn) {
        const row = presetBtn.closest('tr');
        const panel = row?.querySelector('.edit-form');
        const days = parseInt(presetBtn.getAttribute('data-days') || '0', 10);
        applySubscriptionPreset(panel, days);
        return;
      }
      const saveBtn = event.target.closest('.btn-edit-save');
      if (!saveBtn) return;
      const id = saveBtn.getAttribute('data-id');
      const panel = document.getElementById(`edit-${id}`);
      if (!panel) return;
      const username = panel.querySelector('[name="username"]')?.value?.trim();
      const password = panel.querySelector('[name="password"]')?.value || '';
      const display_name = panel.querySelector('[name="display_name"]')?.value?.trim();
      const phone = panel.querySelector('[name="phone"]')?.value?.trim();
      const email = panel.querySelector('[name="email"]')?.value?.trim();
      const starts_at = panel.querySelector('[name="starts_at"]')?.value;
      const ends_at = panel.querySelector('[name="ends_at"]')?.value;
      const render_limit = panel.querySelector('[name="render_limit"]')?.value;
      const reset_render_used = panel.querySelector('[name="reset_render_used"]')?.checked;
      if (!username) {
        flash(pageFlash, 'اسم الدخول مطلوب', false);
        return;
      }
      if (!starts_at || !ends_at) {
        flash(pageFlash, 'أدخل تاريخ بداية ونهاية الاشتراك', false);
        return;
      }
      const subBody = {
        starts_at,
        ends_at,
        render_limit,
        reset_render_used,
        notes: 'تعديل اشتراك من لوحة الإدارة',
      };
      const profileBody = { username, display_name, phone, email };
      if (password.trim()) profileBody.password = password;
      try {
        const subResult = await api(`/api/admin/users/${id}/subscription`, {
          method: 'PUT',
          body: JSON.stringify(subBody),
        });
        await api(`/api/admin/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(profileBody),
        });
        const sub = subResult.user?.subscription || {};
        const from = toDateInput(sub.starts_at) || starts_at;
        const to = toDateInput(sub.ends_at) || ends_at;
        flash(pageFlash, `تم الحفظ — الاشتراك من ${from} إلى ${to}`, true);
        closeAllPanels();
        await refresh();
      } catch (error) {
        flash(pageFlash, error.message, false);
      }
    });
  }

  async function loadMyAccount() {
    if (!accountForm) return;
    try {
      const data = await api('/api/admin/me');
      const u = data.user || {};
      accountForm.username.value = u.username || '';
      accountForm.display_name.value = u.display_name || '';
      if (accountForm.email) accountForm.email.value = u.email || '';
      if (accountForm.password) accountForm.password.value = '';
    } catch (error) {
      const box = document.getElementById('account-form')?.closest('section');
      if (box) box.style.display = 'none';
    }
  }

  accountForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const flashEl = document.getElementById('account-flash');
    const username = accountForm.username.value.trim();
    const display_name = accountForm.display_name.value.trim();
    const password = accountForm.password.value || '';
    if (!username) {
      flash(flashEl, 'اسم الدخول مطلوب', false);
      return;
    }
    const email = accountForm.email?.value?.trim();
    if (!email) {
      flash(flashEl, 'البريد مطلوب للاستعادة', false);
      return;
    }
    const body = { username, display_name, email };
    if (password.trim()) body.password = password;
    try {
      const data = await api('/api/admin/me', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      flash(flashEl, data.message || 'تم حفظ حسابك', true);
      accountForm.password.value = '';
    } catch (error) {
      flash(flashEl, error.message, false);
    }
  });

  function fillSettingsForms(s) {
    if (settingsForm) {
      settingsForm.owner_name.value = s.owner_name || '';
      settingsForm.owner_whatsapp.value = s.owner_whatsapp || '';
      settingsForm.whatsapp_notify_mode.value = s.whatsapp_notify_mode || 'disabled';
      settingsForm.whatsapp_webhook_url.value = s.whatsapp_webhook_url || '';
      settingsForm.expiry_message.value = s.expiry_message || '';
    }
    if (smtpForm) {
      smtpForm.site_public_url.value = s.site_public_url || 'http://127.0.0.1:8000';
      smtpForm.smtp_host.value = s.smtp_host || 'smtp.gmail.com';
      smtpForm.smtp_port.value = s.smtp_port || '587';
      smtpForm.smtp_user.value = s.smtp_user || '';
      if (smtpForm.smtp_password) smtpForm.smtp_password.value = '';
      smtpForm.smtp_from.value = s.smtp_from || '';
    }
  }

  async function loadSettings() {
    try {
      const data = await api('/api/admin/settings');
      fillSettingsForms(data.settings || {});
    } catch (error) {
      flash(document.getElementById('settings-flash'), error.message, false);
    }
  }

  function fillAdmins(admins) {
    if (!adminsBody) return;
    if (!admins.length) {
      adminsBody.innerHTML = '<tr><td colspan="3" class="muted">لا توجد حسابات إدارية بعد</td></tr>';
      return;
    }
    adminsBody.innerHTML = admins
      .map((a) => {
        const role =
          a.role === 'super_admin' ? 'مدير نظام' : a.role === 'ministry_admin' ? 'مدير جهة' : a.role;
        return `<tr>
          <td><strong>${esc(a.display_name)}</strong><br><small class="muted">${esc(a.username)}</small></td>
          <td>${esc(a.email || '—')}</td>
          <td>${esc(role)}</td>
        </tr>`;
      })
      .join('');
  }

  async function loadAdmins() {
    if (!adminsBody) return;
    try {
      const data = await api('/api/admin/admins');
      fillAdmins(data.admins || []);
    } catch (error) {
      adminsBody.innerHTML = `<tr><td colspan="3" class="muted">${esc(error.message)}</td></tr>`;
    }
  }

  async function applyAdminRoleUi() {
    try {
      const data = await api('/api/admin/session');
      const isSuper = Boolean(data.user?.is_super_admin);
      document.querySelectorAll('.super-admin-only').forEach((el) => {
        el.style.display = isSuper ? '' : 'none';
      });
      if (!isSuper && adminsBody) {
        adminsBody.innerHTML =
          '<tr><td colspan="3" class="muted">إضافة حسابات إدارية متاحة لمدير النظام (alimar) فقط</td></tr>';
      }
    } catch (error) {
      document.querySelectorAll('.super-admin-only').forEach((el) => {
        el.style.display = 'none';
      });
    }
  }

  async function refresh() {
    const [ministries, users] = await Promise.all([
      api('/api/admin/ministries'),
      api('/api/admin/users'),
    ]);
    fillMinistries(ministries.ministries || []);
    fillUsers(users.users || []);
  }

  userForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const flashEl = document.getElementById('user-flash');
    const form = new FormData(userForm);
    const ministryId = Number(form.get('ministry_id'));
    if (!ministryId) {
      flash(flashEl, 'اختر الجهة / الوزارة', false);
      return;
    }
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          ministry_id: ministryId,
          username: form.get('username'),
          password: form.get('password'),
          display_name: form.get('display_name'),
          starts_at: form.get('starts_at'),
          ends_at: form.get('ends_at'),
          notes: form.get('notes'),
          render_limit: Number(form.get('render_limit') || 20),
          phone: form.get('phone'),
          email: form.get('email'),
        }),
      });
      userForm.reset();
      setDefaultDates();
      flash(flashEl, 'تم إضافة المشترك بنجاح', true);
      flash(pageFlash, 'تم إضافة مشترك جديد', true);
      await refresh();
    } catch (error) {
      flash(flashEl, error.message, false);
    }
  });

  adminForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const flashEl = document.getElementById('admin-flash');
    const form = new FormData(adminForm);
    const username = String(form.get('username') || '').trim();
    const password = String(form.get('password') || '');
    const email = String(form.get('email') || '').trim();
    if (!username || username.length < 3) {
      flash(flashEl, 'اسم الدخول قصير (3 أحرف على الأقل)', false);
      return;
    }
    if (!password || password.length < 4) {
      flash(flashEl, 'كلمة المرور قصيرة (4 أحرف على الأقل)', false);
      return;
    }
    if (!email || !email.includes('@')) {
      flash(flashEl, 'أدخل بريد Gmail صحيحاً', false);
      return;
    }
    try {
      await api('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          display_name: String(form.get('display_name') || '').trim(),
          email,
          role: form.get('role'),
        }),
      });
      adminForm.reset();
      flash(flashEl, 'تم إضافة الحساب الإداري', true);
      flash(pageFlash, `تم إضافة الحساب: ${username}`, true);
      await loadAdmins();
    } catch (error) {
      flash(flashEl, error.message, false);
      flash(pageFlash, error.message, false);
    }
  });

  smtpForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const flashEl = document.getElementById('smtp-flash');
    const form = new FormData(smtpForm);
    try {
      const data = await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          site_public_url: form.get('site_public_url'),
          smtp_host: form.get('smtp_host'),
          smtp_port: form.get('smtp_port'),
          smtp_user: form.get('smtp_user'),
          smtp_password: form.get('smtp_password'),
          smtp_from: form.get('smtp_from'),
        }),
      });
      fillSettingsForms(data.settings || {});
      flash(flashEl, 'تم حفظ إعدادات Gmail', true);
    } catch (error) {
      flash(flashEl, error.message, false);
    }
  });

  settingsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const flashEl = document.getElementById('settings-flash');
    const form = new FormData(settingsForm);
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          owner_name: form.get('owner_name'),
          owner_whatsapp: form.get('owner_whatsapp'),
          whatsapp_notify_mode: form.get('whatsapp_notify_mode'),
          whatsapp_webhook_url: form.get('whatsapp_webhook_url'),
          expiry_message: form.get('expiry_message'),
        }),
      });
      flash(flashEl, 'تم حفظ إعدادات الموقع', true);
    } catch (error) {
      flash(flashEl, error.message, false);
    }
  });

  document.getElementById('run-reminders-btn')?.addEventListener('click', async () => {
    const flashEl = document.getElementById('settings-flash');
    try {
      const data = await api('/api/admin/reminders/run', { method: 'POST' });
      if (data.error === 'callmebot_not_configured') {
        flash(
          flashEl,
          'CallMeBot: أضف CALLMEBOT_API_KEY في run.bat ثم أعد تشغيل السيرفر',
          false,
        );
        return;
      }
      if (data.error === 'notify_disabled') {
        flash(flashEl, 'واتساب معطّل — اختر CallMeBot أو Webhook في الإعدادات', false);
        return;
      }
      const lines = (data.report || [])
        .map((row) => {
          const name = row.display_name || row.username;
          if (row.ready) {
            return `✓ ${name}: سيُرسل — ${(row.will_send || []).join('، ')}`;
          }
          const why = (row.skip_reasons || []).join('؛ ') || 'لا ينطبق';
          return `— ${name}: ${why}`;
        })
        .join('\n');
      const summary = `تم إرسال ${data.sent || 0} تذكير/تذكيرات`;
      flash(flashEl, lines ? `${summary}\n${lines}` : summary, (data.sent || 0) > 0);
    } catch (error) {
      flash(flashEl, error.message, false);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('deleted')) {
    flash(pageFlash, `تم الحذف: ${decodeURIComponent(urlParams.get('deleted'))}`, true);
    window.history.replaceState({}, '', '/admin');
  }
  if (urlParams.get('delete_error')) {
    flash(pageFlash, decodeURIComponent(urlParams.get('delete_error')), false);
    window.history.replaceState({}, '', '/admin');
  }

  setDefaultDates();
  applyAdminRoleUi().then(() => {
    loadMyAccount();
    loadSettings();
    loadAdmins();
  });
  api('/api/admin/ministries')
    .then((data) => fillMinistries(data.ministries || []))
    .catch((error) => flash(pageFlash, error.message, false));
  refresh().catch((error) => flash(pageFlash, error.message, false));
})();
