// Deterministic mock data generator — frontend-only stand-in for the backend.
// Mirrors the shape and volume of the original PHP seed script
// (database/generate_sql.php) so the UI/UX and data density match the live system.
// Swap this module for real API calls later; every page reads through DataContext,
// so no component changes are required when a backend is introduced.

import {
  SITIOS, STREETS, CRIME_TYPES, TYPE_CATEGORY_MAP, OFFICERS,
  BARANGAY_178_CENTER, CRIMINAL_STATUSES, RESIDENT_STATUSES,
} from './constants';

// Small seeded PRNG so the mock dataset is stable across reloads (nicer demo UX)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(178);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

// Realistic *fictional* Filipino names for demo/sample victim & suspect
// records (this is synthetic seed data — Barangay 178, North Caloocan does
// not exist as a real place and none of these names refer to real people).
// Kept separate from the Resident Registry's own name pool below so the two
// datasets don't read as literally the same 50 people.
const MALE_FIRST_NAMES = ['Juan', 'Pedro', 'Jose', 'Carlos', 'Antonio', 'Manuel', 'Francisco', 'Ramon', 'Eduardo', 'Rafael', 'Fernando', 'Miguel', 'Ricardo', 'Jaime', 'Arturo', 'Rogelio', 'Ruben', 'Ernesto', 'Gregorio', 'Luis', 'Vicente', 'Alberto', 'Roberto', 'Samuel', 'David', 'Daniel', 'Angelo', 'Marlon', 'Noel', 'Reynaldo'];
const FEMALE_FIRST_NAMES = ['Maria', 'Ana', 'Elena', 'Rosa', 'Luz', 'Carmen', 'Gloria', 'Teresa', 'Lourdes', 'Mercedes', 'Cristina', 'Adela', 'Dolores', 'Aurora', 'Socorro', 'Leticia', 'Corazon', 'Milagros', 'Nenita', 'Fe', 'Lilia', 'Nena', 'Remedios', 'Perla', 'Luzviminda', 'Angela', 'Sofia', 'Grace', 'Marites', 'Josefina'];
const CRIME_LAST_NAMES = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Mendoza', 'Aquino', 'Flores', 'Lopez', 'Villanueva', 'Gonzales', 'Torres', 'Rivera', 'Castillo', 'Ramos', 'Fernandez', 'Martinez', 'Rosario', 'Diaz', 'Castro', 'Aguilar', 'Hernandez', 'Mercado', 'Alcantara', 'Valdez', 'Soriano', 'Velasco', 'Bernardo', 'Domingo', 'Pascual'];

// gender is optional — victims have a recorded gender to match against;
// suspects don't (no suspectGender field), so it's left undefined and a
// name is drawn from either pool.
function randomFullName(gender) {
  const pool = gender === 'Male' ? MALE_FIRST_NAMES : gender === 'Female' ? FEMALE_FIRST_NAMES : pick([MALE_FIRST_NAMES, FEMALE_FIRST_NAMES]);
  return `${pick(pool)} ${pick(CRIME_LAST_NAMES)}`;
}

const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];
const BASE_COUNTS = [8, 7, 9, 8, 10, 12, 14, 13, 11, 10, 8, 7];

function generateIncidents() {
  const incidents = [];
  let id = 1;

  MONTHS.forEach((month, mIndex) => {
    const count = Math.min(BASE_COUNTS[mIndex] + randInt(-2, 3), 120 - id + 1);
    for (let i = 0; i < count && id <= 120; i++) {
      const type = pick(CRIME_TYPES);
      const category = TYPE_CATEGORY_MAP[type] || 'Public Order';
      const day = String(randInt(1, 28)).padStart(2, '0');
      const hour = String(randInt(0, 23)).padStart(2, '0');
      const minute = String(randInt(0, 59)).padStart(2, '0');
      const sitio = pick(SITIOS);
      const street = pick(STREETS[sitio]);
      const houseNum = randInt(1, 300);
      // Scattered within ~350m of the barangay center — Barangay 178 is a small
      // urban barangay, not a multi-km area, so keep sample points from spilling
      // into neighboring barangays (e.g. Brgy 176, Bagong Silang).
      const lat = BARANGAY_178_CENTER.lat + randInt(-32, 32) / 10000;
      const lng = BARANGAY_178_CENTER.lng + randInt(-32, 32) / 10000;
      const statusPool = mIndex < 8 ? ['Solved', 'Closed', 'Under Investigation', 'Open'] : ['Open', 'Under Investigation'];
      const status = pick(statusPool);
      const gender = rand() > 0.5 ? 'Male' : 'Female';
      const age = randInt(18, 72);
      const officer = pick(OFFICERS);
      const hasSuspect = randInt(0, 100) > 45;
      const caseNumber = `CN-2025-${String(id).padStart(4, '0')}`;

      incidents.push({
        id: `inc-${id}`,
        incidentId: `INC-${String(id).padStart(5, '0')}`,
        caseNumber,
        crimeType: type,
        category,
        date: `${month}-${day}`,
        time: `${hour}:${minute}`,
        street: `${houseNum} ${street}`,
        sitio,
        latitude: Number(lat.toFixed(7)),
        longitude: Number(lng.toFixed(7)),
        victimName: randomFullName(gender),
        victimAge: age,
        victimGender: gender,
        suspectName: hasSuspect ? randomFullName() : '',
        suspectAge: hasSuspect ? randInt(20, 59) : null,
        reportingOfficer: officer,
        investigatingOfficer: rand() > 0.5 ? pick(OFFICERS) : '',
        badgeNumber: `B178-${randInt(100, 149)}`,
        unit: pick(['Patrol', 'Investigation', 'Traffic', 'Drug Enforcement']),
        status,
        description: `${type} incident reported in ${sitio}, Barangay 178, North Caloocan.`,
        evidence: rand() > 0.5 ? `evidence_${id}.pdf` : '',
        synced_at: rand() > 0.3 ? new Date(Date.now() - randInt(0, 20) * 86400000).toISOString() : null,
      });
      id++;
    }
  });

  return incidents;
}

const FIRST_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Jose', 'Elena', 'Carlos', 'Rosa', 'Antonio', 'Luz', 'Manuel', 'Carmen', 'Francisco', 'Gloria', 'Ramon', 'Teresa', 'Eduardo', 'Lourdes', 'Rafael', 'Mercedes', 'Fernando', 'Cristina', 'Miguel', 'Adela', 'Ricardo', 'Dolores', 'Jaime', 'Aurora', 'Arturo', 'Socorro', 'Rogelio', 'Leticia', 'Ruben', 'Corazon', 'Ernesto', 'Milagros', 'Gregorio', 'Nenita', 'Luis', 'Fe', 'Vicente', 'Lilia', 'Alberto', 'Nena', 'Roberto', 'Remedios', 'Samuel', 'Perla', 'David', 'Luzviminda'];
const LAST_NAMES = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Aquino', 'Flores', 'Lopez', 'Villanueva', 'Gonzales', 'Torres', 'Rivera', 'Castillo', 'Dela Cruz', 'Ramos', 'Fernandez', 'Martinez', 'Rosario', 'Diaz', 'Castro', 'Aguilar', 'Hernandez', 'Mercado', 'Alcantara', 'Valdez', 'Soriano', 'Velasco', 'Manaloto', 'Quijano'];

function generateResidents() {
  const residents = [];
  for (let i = 0; i < 50; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[i % LAST_NAMES.length];
    const sitio = pick(SITIOS);
    const street = pick(STREETS[sitio]);
    const birthYear = 1950 + randInt(0, 60);
    residents.push({
      id: `res-${i + 1}`,
      residentId: `RES-${String(i + 1).padStart(4, '0')}`,
      fullName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      dateOfBirth: `${birthYear}-01-15`,
      gender: rand() > 0.5 ? 'Male' : 'Female',
      civilStatus: pick(['Single', 'Married', 'Widowed', 'Separated']),
      occupation: pick(['Employed', 'Self-Employed', 'Student', 'Unemployed', 'Retired']),
      sitio,
      street,
      contactNumber: `09${randInt(100000000, 999999999)}`,
      status: rand() > 0.9 ? pick(RESIDENT_STATUSES) : 'Active',
    });
  }
  return residents;
}

function generateCriminals(incidents) {
  const suspects = incidents.filter((r) => r.suspectName);
  const criminals = [];
  suspects.slice(0, 25).forEach((inc, i) => {
    const birthYear = 1960 + randInt(0, 40);
    criminals.push({
      id: `crim-${i + 1}`,
      criminalId: `CR-${String(i + 1).padStart(4, '0')}`,
      fullName: inc.suspectName,
      dateOfBirth: `19${randInt(60, 99)}-01-15`.replace('19' + (birthYear - 1900), String(birthYear)),
      gender: rand() > 0.5 ? 'Male' : 'Female',
      address: `${randInt(1, 300)} ${pick(STREETS[inc.sitio])}, ${inc.sitio}, Barangay 178`,
      physicalDescription: `${randInt(150, 185)}cm, ${pick(['slim', 'average', 'heavy', 'athletic'])} build`,
      status: pick(CRIMINAL_STATUSES),
      charges: [inc.crimeType],
      notes: `Known suspect in ${randInt(1, 3)} case(s) within Barangay 178.`,
      relatedCase: inc.caseNumber,
    });
  });
  return criminals;
}

const AUDIT_ACTIONS = [
  { action: 'LOGIN', targetType: 'auth', details: 'User signed in' },
  { action: 'LOGOUT', targetType: 'auth', details: 'User signed out' },
  { action: 'SYNC_STARTED', targetType: 'sync', details: 'Data synchronization started' },
  { action: 'SYNC_COMPLETED', targetType: 'sync', details: 'Data synchronization completed' },
  { action: 'REPORT_GENERATED', targetType: 'report', details: 'Dashboard report generated' },
  { action: 'REPORT_EXPORTED', targetType: 'report', details: 'Report exported as CSV' },
  { action: 'UPDATE', targetType: 'resident', details: 'Resident record updated' },
  { action: 'CREATE', targetType: 'resident', details: 'Resident record created' },
  { action: 'UPDATE', targetType: 'settings', details: 'System settings updated' },
];

function generateAuditLogs(users) {
  const logs = [];
  for (let i = 0; i < 40; i++) {
    const user = pick(users);
    const entry = pick(AUDIT_ACTIONS);
    logs.push({
      id: `log-${i + 1}`,
      timestamp: new Date(Date.now() - i * 3 * 3600000).toISOString(),
      performedBy: user.fullName,
      role: user.role,
      ...entry,
    });
  }
  return logs;
}

function generateNotifications() {
  const items = [
    { title: 'Hotspot Alert', message: 'Sitio 4 has exceeded the hotspot threshold this week.', type: 'warning' },
    { title: 'New Incident', message: 'A new incident was logged in Sitio 2.', type: 'info' },
    { title: 'Case Resolved', message: 'Case CN-2025-0032 was marked as Solved.', type: 'success' },
    { title: 'Sync Complete', message: 'Data synchronization completed successfully.', type: 'success' },
    { title: 'Overdue Case', message: 'Case CN-2025-0011 has been Open for over 30 days.', type: 'warning' },
  ];
  return items.map((n, i) => ({
    id: `notif-${i + 1}`,
    ...n,
    read: i > 2,
    timestamp: new Date(Date.now() - i * 5 * 3600000).toISOString(),
  }));
}

function generateSyncLogs() {
  const logs = [];
  for (let i = 0; i < 10; i++) {
    logs.push({
      id: `sync-${i + 1}`,
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
      status: rand() > 0.15 ? 'completed' : 'failed',
      recordsReceived: randInt(2, 14),
      source: pick(['PNP Regional Feed', 'Manual Upload', 'BADAC Field Report']),
    });
  }
  return logs;
}

let cachedDataset = null;

export function buildMockDataset(users) {
  if (cachedDataset) return cachedDataset;
  const records = generateIncidents();
  cachedDataset = {
    records,
    residents: generateResidents(),
    criminals: generateCriminals(records),
    auditLogs: generateAuditLogs(users),
    notifications: generateNotifications(),
    syncLogs: generateSyncLogs(),
    settings: {
      barangay: 'Barangay 178',
      population: 15000,
      threshold: 5,
      hotspotThreshold: 3,
      categories: ['Property Crime', 'Violent Crime', 'Drug-Related', 'Financial Crime', 'Cybercrime', 'Public Order'],
    },
  };
  return cachedDataset;
}
