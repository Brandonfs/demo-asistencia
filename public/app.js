const userForm = document.getElementById('userForm');
const userStatus = document.getElementById('userStatus') || document.getElementById('statusBanner');
const userDocumentInput = document.getElementById('userDocument');
const userNameInput = document.getElementById('userName');
const startUserScannerBtn = document.getElementById('startUserScannerBtn');
const userReader = document.getElementById('userReader');
const qrBranchSelect = document.getElementById('qrBranchSelect');
const qrTypeSelect = document.getElementById('qrTypeSelect');
const generateQrBtn = document.getElementById('generateQrBtn');
const qrResult = document.getElementById('qrResult');
const qrImage = document.getElementById('qrImage');
const qrPayload = document.getElementById('qrPayload');
const branchForm = document.getElementById('branchForm');
const attendanceRows = document.getElementById('attendanceRows');
const attendanceTypeFilter = document.getElementById('attendanceTypeFilter');
const lateThresholdInput = document.getElementById('lateThresholdInput');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminStatus = document.getElementById('adminStatus');
const adminAuthPanel = document.getElementById('adminAuthPanel');
const adminTools = document.getElementById('adminTools');
const logoutAdminBtn = document.getElementById('logoutAdminBtn');

let currentUser = null;
let qrTimer = null;
let authToken = null;
let streamActive = false;
let mediaStream = null;
let qrScanTimer = null;
let lastScanValue = null;
let qrDetectionActive = false;
let scanCooldown = 0;
let statusResetTimer = null;
let barcodeDetector = null;
let attendanceRecords = [];
let activeAttendanceFilter = 'all';
let activeLateThreshold = '08:30';

function showStatusMessage(message, durationMs = 5000, options = {}) {
  if (!userStatus) {
    return;
  }

  userStatus.textContent = message;
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
  }
  if (!options.persistent) {
    statusResetTimer = setTimeout(() => {
      if (currentUser?.name) {
        userStatus.textContent = `Listo para registrar asistencia: ${currentUser.name}`;
      } else {
        userStatus.textContent = 'Ingresa tus datos para continuar.';
      }
    }, durationMs);
  }
}

function stopCameraScanner(message, durationMs = 8000, persistent = false) {
  qrDetectionActive = false;
  lastScanValue = null;
  if (qrScanTimer) {
    clearInterval(qrScanTimer);
    qrScanTimer = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  streamActive = false;
  if (userReader) {
    userReader.srcObject = null;
  }
  if (startUserScannerBtn) {
    startUserScannerBtn.textContent = 'Abrir cámara';
  }
  if (message) {
    showStatusMessage(message, durationMs, { persistent });
  }
}

function stopQrTimer() {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

function setAdminAuthenticated(isLoggedIn) {
  if (adminAuthPanel) {
    adminAuthPanel.classList.toggle('hidden', isLoggedIn);
  }
  if (adminTools) {
    adminTools.classList.toggle('hidden', !isLoggedIn);
  }
}

async function loadBranches() {
  if (!qrBranchSelect) {
    return;
  }

  const res = await fetch('/api/branches');
  const branches = await res.json();
  const options = branches.map((branch) => `<option value="${branch.id}">${branch.name}</option>`).join('');
  qrBranchSelect.innerHTML = options;
}

async function loadAttendance() {
  if (!attendanceRows) {
    return;
  }

  const res = await fetch('/api/attendance');
  const data = await res.json();
  attendanceRecords = data;
  renderAttendanceRows();
}

function renderAttendanceRows() {
  if (!attendanceRows) {
    return;
  }

  const filteredRecords = attendanceRecords.filter((row) => {
    const matchesType = activeAttendanceFilter === 'all' || (row.attendanceType || 'entrada') === activeAttendanceFilter;
    const timeValue = row.scannedAt ? new Date(row.scannedAt).toTimeString().slice(0, 5) : null;
    const matchesLate = !activeLateThreshold || !timeValue || timeValue > activeLateThreshold;
    return matchesType && matchesLate;
  });

  attendanceRows.innerHTML = filteredRecords.length
    ? filteredRecords
        .map((row) => {
          const verified = row.verified === 1 || row.verified === true;
          const scannedTime = row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString('es-ES') : '-';
          const isLate = activeLateThreshold && row.attendanceType === 'entrada' && row.scannedAt && new Date(row.scannedAt).toTimeString().slice(0, 5) > activeLateThreshold;
          const rowClass = isLate ? 'late-row' : '';
          return `
            <tr class="${rowClass}">
              <td>${row.employeeName}</td>
              <td>${row.branchName || row.branchId}</td>
              <td>${row.attendanceType || 'entrada'}</td>
              <td>${scannedTime}</td>
              <td>
                <button class="verify-btn" data-id="${row.id}" data-verified="${verified ? 'true' : 'false'}">
                  ${verified ? 'Quitar verificación' : 'Verificar'}
                </button>
              </td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="5">No hay registros aún</td></tr>';
}

function applyAttendanceFilters() {
  activeAttendanceFilter = attendanceTypeFilter?.value || 'all';
  activeLateThreshold = lateThresholdInput?.value || '08:30';
  renderAttendanceRows();
}

function exportAttendance(format) {
  if (!attendanceRecords.length) {
    return;
  }

  const rows = attendanceRecords
    .filter((row) => {
      const matchesType = activeAttendanceFilter === 'all' || (row.attendanceType || 'entrada') === activeAttendanceFilter;
      const timeValue = row.scannedAt ? new Date(row.scannedAt).toTimeString().slice(0, 5) : null;
      const matchesLate = !activeLateThreshold || !timeValue || timeValue > activeLateThreshold;
      return matchesType && matchesLate;
    })
    .map((row) => ({
      Trabajador: row.employeeName,
      Sede: row.branchName || row.branchId,
      Tipo: row.attendanceType || 'entrada',
      Hora: new Date(row.scannedAt).toLocaleTimeString('es-ES'),
      Estado: row.verified ? 'Verificado' : 'Pendiente',
    }));

  if (format === 'excel') {
    const csv = [
      ['Trabajador', 'Sede', 'Tipo', 'Hora', 'Estado'],
      ...rows.map((row) => [row.Trabajador, row.Sede, row.Tipo, row.Hora, row.Estado]),
    ]
      .map((line) => line.join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asistencia.csv';
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === 'pdf') {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head><title>Reporte de asistencia</title></head>
        <body>
          <h2>Reporte de asistencia</h2>
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr>
                <th style="border:1px solid #999; padding:6px;">Trabajador</th>
                <th style="border:1px solid #999; padding:6px;">Sede</th>
                <th style="border:1px solid #999; padding:6px;">Tipo</th>
                <th style="border:1px solid #999; padding:6px;">Hora</th>
                <th style="border:1px solid #999; padding:6px;">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td style="border:1px solid #999; padding:6px;">${row.Trabajador}</td>
                  <td style="border:1px solid #999; padding:6px;">${row.Sede}</td>
                  <td style="border:1px solid #999; padding:6px;">${row.Tipo}</td>
                  <td style="border:1px solid #999; padding:6px;">${row.Hora}</td>
                  <td style="border:1px solid #999; padding:6px;">${row.Estado}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }
}

async function generateQr() {
  const payload = {
    branchId: qrBranchSelect.value,
    attendanceType: qrTypeSelect.value,
  };

  const res = await fetch('/api/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    qrPayload.textContent = data.error || 'No se pudo generar el QR';
    return;
  }

  qrImage.src = data.image;
  qrPayload.textContent = `Sede: ${qrBranchSelect.options[qrBranchSelect.selectedIndex]?.text || 'Sede'} · Tipo: ${qrTypeSelect.value} · Se actualiza cada 10 segundos`;
  qrResult.classList.remove('hidden');
}

function startQrRotation() {
  stopQrTimer();
  generateQr();
  qrTimer = setInterval(() => {
    generateQr();
    if (qrPayload) {
      qrPayload.textContent = `Sede: ${qrBranchSelect.options[qrBranchSelect.selectedIndex]?.text || 'Sede'} · Tipo: ${qrTypeSelect.value} · Se actualiza cada 10 segundos`;
    }
  }, 10000);
}

if (userForm) {
  userForm.addEventListener('submit', (event) => {
    event.preventDefault();
    currentUser = {
      document: userDocumentInput?.value.trim() || '',
      name: userNameInput?.value.trim() || '',
    };

    if (!currentUser.document || !currentUser.name) {
      if (userStatus) {
        userStatus.textContent = 'Completa CC y nombre para continuar.';
      }
      return;
    }

    localStorage.setItem('attendanceUser', JSON.stringify(currentUser));
    if (userStatus) {
      userStatus.textContent = `Listo para registrar asistencia: ${currentUser.name}`;
    }
  });
}

async function openCameraScanner() {
  if (!currentUser) {
    userStatus.textContent = 'Primero completa CC y nombre.';
    return;
  }

  if (!window.isSecureContext) {
    userStatus.textContent = 'La cámara solo funciona en páginas seguras. Abre esta demo con HTTPS.';
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    userStatus.textContent = 'Este navegador no soporta acceso a cámara.';
    return;
  }

  try {
    if (streamActive && mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

    streamActive = true;
    userReader.srcObject = mediaStream;
    userReader.playsInline = true;
    userReader.autoplay = true;
    userReader.muted = true;

    if ('BarcodeDetector' in window) {
      barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }

    await userReader.play().catch(() => {});
    showStatusMessage('Cámara lista. Enfoca el QR dentro del marco y muévelo lentamente.', 5000);
    qrDetectionActive = true;
    scanCooldown = 0;

    if (qrScanTimer) {
      clearInterval(qrScanTimer);
    }

    qrScanTimer = setInterval(async () => {
      if (!qrDetectionActive || !userReader.videoWidth || !userReader.videoHeight) {
        return;
      }

      if (!barcodeDetector) {
        showStatusMessage('Tu navegador no soporta lectura de QR. Prueba con Chrome o Edge en Android.', 3000);
        return;
      }

      try {
        if (scanCooldown > 0) {
          scanCooldown -= 500;
          return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = userReader.videoWidth;
        canvas.height = userReader.videoHeight;
        context.drawImage(userReader, 0, 0, canvas.width, canvas.height);

        const barcodes = await barcodeDetector.detect(canvas);
        const code = barcodes?.[0];
        if (!code?.rawValue) {
          return;
        }

        let token = null;
        try {
          const parsedUrl = new URL(code.rawValue);
          token = parsedUrl.searchParams.get('token');
        } catch (error) {
          token = code.rawValue;
        }

        if (!token || token === lastScanValue) {
          return;
        }
        lastScanValue = token;
        scanCooldown = 3000;
        showStatusMessage('QR detectado. Registrando asistencia...', 5000);

        const res = await fetch('/api/attendance/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            employeeId: currentUser.document,
            employeeName: currentUser.name,
          }),
        });
        const dataRes = await res.json();

        if (!res.ok) {
          const duplicateConflict = res.status === 409 || /ya existe|registro de este tipo|hoy/i.test(dataRes.error || '');
          if (duplicateConflict) {
            stopCameraScanner('Ya existe un registro de este tipo para hoy. La cámara se cerró.', 8000, true);
            return;
          }
          showStatusMessage(dataRes.message || dataRes.error || 'No se pudo registrar la asistencia.', 5000);
          return;
        }

        showStatusMessage(dataRes.message || 'Asistencia registrada.', 5000);
        loadAttendance();
        qrDetectionActive = false;
        stopCameraScanner(dataRes.message || 'Asistencia registrada.', 5000);
      } catch (error) {
        showStatusMessage('Mueve el teléfono lentamente y centra el QR dentro del marco.', 2000);
      }
    }, 500);
  } catch (error) {
    const message = error?.message || 'No se pudo abrir la cámara.';
    if (/Permission|denied|NotAllowed/i.test(message)) {
      userStatus.textContent = 'Se denegó el acceso a la cámara. Activa los permisos y vuelve a intentarlo.';
    } else {
      userStatus.textContent = `No se pudo abrir la cámara: ${message}`;
    }
  }
}

if (startUserScannerBtn) {
  startUserScannerBtn.addEventListener('click', async () => {
    await openCameraScanner();
  });
}

if (generateQrBtn) {
  generateQrBtn.addEventListener('click', generateQr);
}
if (qrBranchSelect) {
  qrBranchSelect.addEventListener('change', generateQr);
}
if (qrTypeSelect) {
  qrTypeSelect.addEventListener('change', generateQr);
}

if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value.trim();

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (adminStatus) {
        adminStatus.textContent = data.error || 'No se pudo iniciar sesión.';
      }
      return;
    }

    authToken = data.token;
    localStorage.setItem('attendanceAdminToken', data.token);
    setAdminAuthenticated(true);
    if (adminStatus) {
      adminStatus.textContent = `Administrador conectado: ${data.user.fullName}`;
    }
    await loadBranches();
    await loadAttendance();
  });
}

if (logoutAdminBtn) {
  logoutAdminBtn.addEventListener('click', async () => {
    if (authToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    }
    authToken = null;
    localStorage.removeItem('attendanceAdminToken');
    setAdminAuthenticated(false);
    if (adminStatus) {
      adminStatus.textContent = 'Sesión cerrada.';
    }
  });
}

if (branchForm) {
  branchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: document.getElementById('branchName').value.trim(),
      location: document.getElementById('branchLocation').value.trim(),
    };

    const res = await fetch('/api/branches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      document.getElementById('branchName').value = '';
      document.getElementById('branchLocation').value = '';
      loadBranches();
    }
  });
}

if (applyFiltersBtn) {
  applyFiltersBtn.addEventListener('click', applyAttendanceFilters);
}
if (exportExcelBtn) {
  exportExcelBtn.addEventListener('click', () => exportAttendance('excel'));
}
if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', () => exportAttendance('pdf'));
}

if (attendanceRows) {
  attendanceRows.addEventListener('click', async (event) => {
    const btn = event.target.closest('.verify-btn');
    if (!btn) return;

    const verified = btn.dataset.verified !== 'true';
    const res = await fetch(`/api/attendance/${btn.dataset.id}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ verified }),
    });

    if (res.ok) {
      loadAttendance();
    }
  });
}

async function initializeSession() {
  const savedUser = localStorage.getItem('attendanceUser');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    if (userDocumentInput) userDocumentInput.value = currentUser.document || '';
    if (userNameInput) userNameInput.value = currentUser.name || '';
    if (userStatus) {
      userStatus.textContent = `Sesión restaurada para ${currentUser.name}`;
    }
  }

  const savedToken = localStorage.getItem('attendanceAdminToken');
  if (savedToken) {
    authToken = savedToken;
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setAdminAuthenticated(true);
      if (adminStatus) {
        adminStatus.textContent = `Administrador conectado: ${data.user.fullName}`;
      }
      await loadAttendance();
    } else {
      localStorage.removeItem('attendanceAdminToken');
      authToken = null;
      setAdminAuthenticated(false);
    }
  }
}

if (qrBranchSelect) {
  loadBranches();
}
if (attendanceRows) {
  loadAttendance();
}
if (generateQrBtn) {
  startQrRotation();
}
initializeSession();
