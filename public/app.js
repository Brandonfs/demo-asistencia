const roleSelect = document.getElementById('roleSelect');
const rolePanels = document.querySelectorAll('.role-panel');

const userForm = document.getElementById('userForm');
const userStatus = document.getElementById('userStatus');
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
const adminLoginForm = document.getElementById('adminLoginForm');
const adminStatus = document.getElementById('adminStatus');
const adminAuthPanel = document.getElementById('adminAuthPanel');
const adminTools = document.getElementById('adminTools');
const logoutAdminBtn = document.getElementById('logoutAdminBtn');

let html5QrCode;
let currentUser = null;
let qrTimer = null;
let authToken = null;

function switchRole(role) {
  rolePanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `${role}Panel`);
  });
}

function stopQrTimer() {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

function setAdminAuthenticated(isLoggedIn) {
  adminAuthPanel.classList.toggle('hidden', isLoggedIn);
  adminTools.classList.toggle('hidden', !isLoggedIn);
}

async function loadBranches() {
  const res = await fetch('/api/branches');
  const branches = await res.json();
  const options = branches.map((branch) => `<option value="${branch.id}">${branch.name}</option>`).join('');
  qrBranchSelect.innerHTML = options;
}

async function loadAttendance() {
  const res = await fetch('/api/attendance');
  const data = await res.json();

  attendanceRows.innerHTML = data.length
    ? data
        .map((row) => {
          const verified = row.verified === 1 || row.verified === true;
          return `
            <tr>
              <td>${row.employeeName}</td>
              <td>${row.branchName || row.branchId}</td>
              <td>${row.attendanceType || 'entrada'}</td>
              <td>${new Date(row.scannedAt).toLocaleTimeString('es-ES')}</td>
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
  qrPayload.textContent = `Sede: ${qrBranchSelect.options[qrBranchSelect.selectedIndex]?.text || 'Sede'} · Tipo: ${qrTypeSelect.value}`;
  qrResult.classList.remove('hidden');
}

function startQrRotation() {
  stopQrTimer();
  generateQr();
  qrTimer = setInterval(generateQr, 3000);
}

userForm.addEventListener('submit', (event) => {
  event.preventDefault();
  currentUser = {
    document: document.getElementById('userDocument').value.trim(),
    name: document.getElementById('userName').value.trim(),
  };

  if (!currentUser.document || !currentUser.name) {
    userStatus.textContent = 'Completa CC y nombre para continuar.';
    return;
  }

  localStorage.setItem('attendanceUser', JSON.stringify(currentUser));
  userStatus.textContent = `Listo para registrar asistencia: ${currentUser.name}`;
});

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

  if (!window.Html5Qrcode) {
    userStatus.textContent = 'No se pudo cargar el escáner de cámara. Intenta recargar la página.';
    return;
  }

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras?.length) {
      userStatus.textContent = 'No se encontró una cámara disponible en este dispositivo.';
      return;
    }

    const rearCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label)) || cameras[0];
    const cameraId = rearCamera?.id || { facingMode: 'environment' };

    html5QrCode = new Html5Qrcode('userReader');
    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    userStatus.textContent = 'Abriendo cámara... apunta al QR.';

    await html5QrCode.start(cameraId, config, async (decodedText) => {
      const token = new URL(decodedText).searchParams.get('token');
      if (!token) {
        userStatus.textContent = 'El QR no contiene un token válido.';
        return;
      }

      const res = await fetch('/api/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          employeeId: currentUser.document,
          employeeName: currentUser.name,
        }),
      });
      const data = await res.json();
      userStatus.textContent = data.message || data.error || 'Asistencia registrada.';
      await html5QrCode.stop();
      if (res.ok) {
        loadAttendance();
      }
    });
  } catch (error) {
    const message = error?.message || 'No se pudo abrir la cámara.';
    if (/Permission|denied|NotAllowed/i.test(message)) {
      userStatus.textContent = 'Se denegó el acceso a la cámara. Activa los permisos y vuelve a intentarlo.';
    } else if (/NotFound|No camera|devices/i.test(message)) {
      userStatus.textContent = 'No se encontró una cámara disponible en este dispositivo.';
    } else {
      userStatus.textContent = `No se pudo abrir la cámara: ${message}`;
    }
  }
}

startUserScannerBtn.addEventListener('click', async () => {
  await openCameraScanner();
});

generateQrBtn.addEventListener('click', generateQr);
qrBranchSelect.addEventListener('change', generateQr);
qrTypeSelect.addEventListener('change', generateQr);
roleSelect.addEventListener('change', (event) => switchRole(event.target.value));

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
    adminStatus.textContent = data.error || 'No se pudo iniciar sesión.';
    return;
  }

  authToken = data.token;
  localStorage.setItem('attendanceAdminToken', data.token);
  setAdminAuthenticated(true);
  adminStatus.textContent = `Administrador conectado: ${data.user.fullName}`;
  await loadBranches();
  await loadAttendance();
});

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
  adminStatus.textContent = 'Sesión cerrada.';
});

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

async function initializeSession() {
  const savedUser = localStorage.getItem('attendanceUser');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    document.getElementById('userDocument').value = currentUser.document || '';
    document.getElementById('userName').value = currentUser.name || '';
    userStatus.textContent = `Sesión restaurada para ${currentUser.name}`;
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
      adminStatus.textContent = `Administrador conectado: ${data.user.fullName}`;
      await loadAttendance();
    } else {
      localStorage.removeItem('attendanceAdminToken');
      authToken = null;
      setAdminAuthenticated(false);
    }
  }
}

loadBranches();
loadAttendance();
startQrRotation();
initializeSession();
switchRole(roleSelect.value);
