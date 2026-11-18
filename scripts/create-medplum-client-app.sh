#!/bin/bash

echo "🔧 Creating Medplum ClientApplication for Backend Access"
echo "=========================================================="
echo ""
echo "This will create a ClientApplication with client_credentials for"
echo "server-to-server authentication (no browser/PKCE required)."
echo ""

# Configuration
MEDPLUM_URL="${MEDPLUM_BASE_URL:-http://localhost:8103}"
MEDPLUM_EMAIL="${MEDPLUM_EMAIL:?set MEDPLUM_EMAIL}"
MEDPLUM_PASSWORD="${MEDPLUM_PASSWORD}"

if [ -z "$MEDPLUM_PASSWORD" ]; then
  echo "⚠️  MEDPLUM_PASSWORD not set in environment"
  read -sp "Enter your Medplum password: " MEDPLUM_PASSWORD
  echo ""
fi

echo "📧 Logging in as: $MEDPLUM_EMAIL"
echo "🌐 Medplum URL: $MEDPLUM_URL"
echo ""

# Step 1: Login to get access token
echo "1️⃣  Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$MEDPLUM_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$MEDPLUM_EMAIL\", \"password\": \"$MEDPLUM_PASSWORD\"}")

# Check if we got a code (2-step flow) or direct token
CODE=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('code', ''))" 2>/dev/null)
LOGIN_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('login', ''))" 2>/dev/null)

if [ -n "$CODE" ] && [ -n "$LOGIN_ID" ]; then
  echo "🔄 Exchanging code for token..."
  
  TOKEN_RESPONSE=$(curl -s -X POST "$MEDPLUM_URL/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=$CODE&code_verifier=$LOGIN_ID")
  
  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('access_token', ''))" 2>/dev/null)
else
  # Try direct access token
  ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('access_token', ''))" 2>/dev/null)
fi

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Failed to get access token"
  echo "Response: $LOGIN_RESPONSE"
  echo "Token Response: $TOKEN_RESPONSE"
  exit 1
fi

echo "✅ Logged in successfully"
echo ""

# Step 2: Get user profile to find project ID
echo "2️⃣  Getting user profile..."
PROFILE_RESPONSE=$(curl -s -X GET "$MEDPLUM_URL/auth/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

PROJECT_ID=$(echo "$PROFILE_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('project', {}).get('id', ''))" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Failed to get project ID"
  echo "Response: $PROFILE_RESPONSE"
  exit 1
fi

echo "✅ Project ID: $PROJECT_ID"
echo ""

# Step 3: Create ClientApplication
echo "3️⃣  Creating ClientApplication..."
CLIENT_NAME="EMR Backend Client"
CLIENT_DESCRIPTION="Server-to-server authentication for EMR backend"

CLIENT_RESPONSE=$(curl -s -X POST "$MEDPLUM_URL/admin/projects/$PROJECT_ID/client" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$CLIENT_NAME\",
    \"description\": \"$CLIENT_DESCRIPTION\"
  }")

CLIENT_ID=$(echo "$CLIENT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', ''))" 2>/dev/null)
CLIENT_SECRET=$(echo "$CLIENT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('secret', ''))" 2>/dev/null)

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "❌ Failed to create client"
  echo "Response: $CLIENT_RESPONSE"
  exit 1
fi

echo "✅ ClientApplication created!"
echo ""
echo "=========================================================="
echo "🎉 SUCCESS! Client Credentials Created"
echo "=========================================================="
echo ""
echo "Add these to your .env.local file:"
echo ""
echo "MEDPLUM_CLIENT_ID=$CLIENT_ID"
echo "MEDPLUM_CLIENT_SECRET=$CLIENT_SECRET"
echo ""
echo "Then remove (or comment out) the email/password lines:"
echo "# MEDPLUM_EMAIL=$MEDPLUM_EMAIL"
echo "# MEDPLUM_PASSWORD=***"
echo ""
echo "🚀 Your backend can now authenticate using client_credentials!"
echo ""









