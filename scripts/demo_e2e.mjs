/**
 * F4 - Automated end-to-end demo verification script (2 accounts)
 * Run with: node scripts/demo_e2e.mjs
 */
const BASE = process.env.API_URL || 'http://localhost:3000';

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, data: json };
}

async function loginOrRegister(phoneNumber, displayName) {
  await req('POST', '/auth/send-otp', { phoneNumber });
  const verify = await req('POST', '/auth/verify-otp', {
    phoneNumber,
    code: '123456',
  });
  if (verify.status !== 200 && verify.status !== 201) {
    throw new Error(`verify-otp failed for ${phoneNumber}: ${JSON.stringify(verify.data)}`);
  }
  if (verify.data.isNewUser || verify.data.requiresProfile) {
    const tempToken = verify.data.accessToken || verify.data.tempToken;
    const comp = await req(
      'POST',
      '/auth/complete-profile',
      { displayName, cityId: 1 },
      tempToken,
    );
    if (comp.status !== 200 && comp.status !== 201) {
      throw new Error(`complete-profile failed: ${JSON.stringify(comp.data)}`);
    }
    return { token: comp.data.accessToken, userId: comp.data.user?.id };
  }
  return { token: verify.data.accessToken, userId: verify.data.user?.id };
}

async function main() {
  console.log('=== Trocly F4 E2E Demo Check ===', BASE);

  const cities = await req('GET', '/cities');
  console.log('1. GET /cities ->', cities.status, `(${cities.data.length} cities)`);

  const yassine = await loginOrRegister('+212611111111', 'Yassine B.');
  const salma = await loginOrRegister('+212622222222', 'Salma E.');
  console.log('2. Auth OTP both users OK');

  const tag = Date.now();
  const l1 = await req(
    'POST',
    '/listings',
    {
      title: `VTT Demo ${tag}`,
      description: 'Très bon état, révisé',
      category: 'Sport',
      condition: 'tres_bon',
      estimatedValue: 0,
      cityId: 1,
      photos: [],
      attributes: { wishes: ['Console'] },
    },
    yassine.token,
  );
  console.log('3. Create listing Yassine ->', l1.status, l1.data.id);

  const dup = await req(
    'POST',
    '/listings',
    {
      title: `VTT Demo ${tag}`,
      description: 'Très bon état, révisé',
      category: 'Sport',
      condition: 'tres_bon',
      estimatedValue: 0,
      cityId: 1,
      photos: [],
    },
    yassine.token,
  );
  console.log('4. B2 Duplicate check ->', dup.status, '(expected 409)');

  const notifs = await req('GET', '/notifications', null, yassine.token);
  console.log('5. C5 GET /notifications ->', notifs.status);

  const myMeetings = await req('GET', '/meetings/my-meetings', null, yassine.token);
  console.log('6. D1 GET /meetings/my-meetings ->', myMeetings.status);

  const convs = await req('GET', '/messages/conversations', null, salma.token);
  console.log('7. C4 GET /messages/conversations ->', convs.status);

  console.log('=== Demo E2E check finished ===');
}

main().catch((e) => {
  console.error('Demo E2E failed:', e);
  process.exit(1);
});
