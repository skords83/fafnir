import { auth } from '../src/auth';

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SEED_USER_EMAIL and SEED_USER_PASSWORD env vars before running this script.');
  }

  await auth.api.signUpEmail({
    body: { email, password, name: email },
  });

  console.log(`[create-user] created user ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[create-user] failed:', err);
    process.exit(1);
  });
