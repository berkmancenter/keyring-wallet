# Local Mediator Setup for Testing

This guide provides step-by-step instructions to spin up a local Credo-ts mediator for testing multi-use invitations.

## Quick Setup (Recommended)

### Prerequisites
- Node.js (same version as your project)
- Git

### Step 1: Clone Credo-ts Repository

```bash
# Clone in a temporary location (not in your project)
cd /tmp
git clone https://github.com/openwallet-foundation/credo-ts.git
cd credo-ts
```

### Step 2: Install Dependencies with pnpm

**Important**: Credo-ts uses **pnpm**, not yarn or npm!

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Install dependencies
pnpm install
```

### Step 3: Start the Mediator

```bash
# Run the mediator (this handles building and starting)
pnpm run-mediator
```

The mediator will start on port 3001. The invitation URL is available at:
```
http://localhost:3001/invitation
```

**You can access the invitation in your browser or via curl:**
```bash
# Get the invitation URL
curl http://localhost:3001/invitation
```

This will return a JSON response with the invitation URL that you'll use in your tests.

### Step 6: Update Your Test Configuration

Copy the invitation URL and update your `.env` file:

```bash
cd /home/brendan/code/asml/AdvancedIdentity/bifold/vrc_reference
echo 'MEDIATOR_INVITATION_URL=http://localhost:3001?oob=<your-invitation-here>' > .env
```

### Step 7: Clean Test Data and Run Tests

```bash
# Clean previous wallet data
rm -rf .wallets/*

# Run multi-use invitation test
npm test -- --testPathPattern=connectionMediatedFlowMultiUse --testNamePattern="should allow multiple agents to connect"
```

## Alternative: Using Docker (If Available)

If a Credo mediator Docker image is available:

```bash
# Pull the mediator image
docker pull <mediator-image>

# Run the mediator
docker run -p 3001:3001 <mediator-image>
```

## Troubleshooting

### Issue: "Cannot find module" errors
Solution: Make sure you ran `pnpm install` in the credo-ts root

### Issue: Port already in use
Solution: Stop any process using port 3001 or modify the mediator code to use a different port

### Issue: Can't access invitation URL
Solution: Make sure the mediator is running and visit `http://localhost:3001/invitation` in your browser or use curl

## Automated Setup Script

Save this as `setup-local-mediator.sh`:

```bash
#!/bin/bash

# Local Mediator Setup Script
set -e

TEMP_DIR="/tmp/credo-mediator-test"

echo "🔧 Setting up local Credo-ts mediator..."

# Clean up old installation
rm -rf "$TEMP_DIR"

# Clone Credo-ts
echo "📥 Cloning Credo-ts..."
git clone https://github.com/openwallet-foundation/credo-ts.git "$TEMP_DIR"
cd "$TEMP_DIR"

# Install pnpm if needed
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi

# Install dependencies
echo "📦 Installing dependencies with pnpm..."
pnpm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the mediator, run:"
echo "  cd $TEMP_DIR"
echo "  pnpm run-mediator"
echo ""
echo "Invitation URL will be available at: http://localhost:3001/invitation"
```

Make it executable and run:
```bash
chmod +x setup-local-mediator.sh
./setup-local-mediator.sh
```

## Comparing Results

### Test Matrix

Run both tests with local mediator and document results:

```bash
# 1. Single-use invitation test
npm test -- --testPathPattern=connectionMediatedFlow --testNamePattern="should establish connection"

# 2. Multi-use invitation test  
npm test -- --testPathPattern=connectionMediatedFlowMultiUse --testNamePattern="should allow multiple agents to connect"
```

### Expected Outcomes

#### Scenario A: Local Mediator Works ✅
- **Conclusion**: Issue is specific to Berkman mediator
- **Action**: Report bug to Berkman mediator team
- **Solution**: Either fix Berkman mediator or use alternative

#### Scenario B: Local Mediator Also Fails ❌
- **Conclusion**: Issue is in Credo-ts framework or test code
- **Action**: Report to Credo-ts team or debug test implementation
- **Investigation**: Check Credo-ts version compatibility

## Enabling Debug Logging

For more detailed debugging, set log level to debug:

```bash
# In your .env file
CREDO_LOG_LEVEL=debug

# Or set it directly when running tests
CREDO_LOG_LEVEL=debug npm test -- --testPathPattern=connectionMediatedFlowMultiUse
```

## Stopping the Mediator

When done testing:
```bash
# Press Ctrl+C in the terminal running the mediator

# Optionally clean up the temporary installation
rm -rf /tmp/credo-mediator-test
```

## Quick Command Summary

```bash
# One-time setup
cd /tmp
git clone https://github.com/openwallet-foundation/credo-ts.git
cd credo-ts
npm install -g pnpm  # If you don't have pnpm
pnpm install

# Start mediator (run this each time you want to test)
pnpm run-mediator

# In another terminal: Get invitation URL and configure tests
curl http://localhost:3001/invitation  # Copy the invitation URL

cd /home/brendan/code/asml/AdvancedIdentity/bifold/vrc_reference
echo 'MEDIATOR_INVITATION_URL=<paste-invitation-url>' > .env
rm -rf .wallets/*

# Run the tests
npm test -- --testPathPattern=connectionMediatedFlowMultiUse --testNamePattern="should allow multiple agents to connect"
```

---

**Time Estimate**: 2-3 minutes for initial setup, instant for subsequent runs
