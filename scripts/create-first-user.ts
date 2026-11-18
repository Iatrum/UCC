/**
 * Create your first EMR user in Medplum
 * Run: bun run scripts/create-first-user.ts
 */

import { MedplumClient } from '@medplum/core';

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || 'http://localhost:8103';
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID!;
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET!;

async function createFirstUser() {
  console.log('\n🔐 Creating First EMR User...\n');

  // Connect to Medplum with client credentials
  const medplum = new MedplumClient({
    baseUrl: MEDPLUM_BASE_URL,
  });

  console.log('📡 Connecting to Medplum...');
  await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);
  console.log('✅ Connected!\n');

  // User details
  const email = process.env.FIRST_USER_EMAIL;
  const password = process.env.FIRST_USER_PASSWORD;
  const firstName = 'Hidayat';
  const lastName = 'Doctor';

  if (!email || !password) {
    console.error('Set FIRST_USER_EMAIL and FIRST_USER_PASSWORD in the environment.');
    process.exit(1);
  }

  try {
    // Check if user already exists
    console.log('🔍 Checking if user exists...');
    const existingUser = await medplum.searchOne('Practitioner', {
      email: email,
    });

    if (existingUser) {
      console.log('⚠️  User already exists!');
      console.log('📧 Email:', email);
      console.log('🆔 Practitioner ID:', existingUser.id);
      console.log('\n💡 Try logging in with your password.');
      console.log('   If you forgot it, reset it in Medplum admin console.\n');
      return;
    }

    // Create Practitioner resource
    console.log('👨‍⚕️ Creating Practitioner...');
    const practitioner = await medplum.createResource({
      resourceType: 'Practitioner',
      name: [{
        use: 'official',
        family: lastName,
        given: [firstName],
        text: `${firstName} ${lastName}`,
      }],
      telecom: [{
        system: 'email',
        value: email,
        use: 'work',
      }],
      active: true,
    });

    console.log('✅ Practitioner created:', practitioner.id);

    // Create User account (using Medplum admin API)
    console.log('👤 Creating user account...');
    
    // Note: This requires admin API access
    // For now, we'll create the Practitioner, and you'll need to:
    // 1. Go to Medplum admin console (http://localhost:8103)
    // 2. Navigate to "Users"
    // 3. Create new user with this email
    // 4. Link to the Practitioner we just created
    
    console.log('\n✅ Practitioner Created Successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:', email);
    console.log('🆔 Practitioner ID:', practitioner.id);
    console.log('👤 Name:', `${firstName} ${lastName}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📋 NEXT STEPS:\n');
    console.log('1. Open Medplum admin console:');
    console.log('   http://localhost:8103\n');
    console.log('2. Login with admin credentials\n');
    console.log('3. Go to: Admin → Users → Create New\n');
    console.log('4. Fill in:');
    console.log(`   Email: ${email}`);
    console.log('   Password: (the value of FIRST_USER_PASSWORD)');
    console.log(`   Link to Practitioner: ${practitioner.id}\n`);
    console.log('5. Save\n');
    console.log('6. Try logging into your EMR:');
    console.log('   http://localhost:3000/login\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    
    console.log('\n💡 ALTERNATIVE: Create user manually in Medplum admin:\n');
    console.log('1. Go to: http://localhost:8103');
    console.log('2. Login with admin credentials');
    console.log('3. Create Practitioner + User');
    console.log(`4. Use email: ${email}`);
    console.log('5. Use the password from FIRST_USER_PASSWORD\n');
  }
}

createFirstUser();








