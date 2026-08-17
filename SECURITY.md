# Security Documentation

## Overview

This document outlines the security enhancements and best practices for the FlashLoanArbitrage contract. The contract has been hardened with multiple layers of security to protect against common attack vectors.

## Security Features

### 1. Role-Based Access Control (RBAC)

The contract uses OpenZeppelin's `AccessControl` instead of simple `Ownable` to provide granular permission management:

#### Roles
- **DEFAULT_ADMIN_ROLE**: Can grant/revoke all roles
- **ADMIN_ROLE**: Full administrative access (withdraw, manage roles, whitelist)
- **OPERATOR_ROLE**: Can execute arbitrage operations only
- **PAUSER_ROLE**: Can pause/unpause the contract for emergency response

#### Security Best Practices
- Never use the same address for all roles in production
- Use hardware wallets for ADMIN and PAUSER roles
- Consider using a multisig for the ADMIN role
- Grant OPERATOR_ROLE to a dedicated bot address
- Grant PAUSER_ROLE to a separate emergency response address

### 2. Pausable Functionality

The contract implements OpenZeppelin's `Pausable` pattern for emergency stops:

#### Features
- Contract can be paused by anyone with PAUSER_ROLE
- All arbitrage operations are blocked when paused
- Only ADMIN_ROLE can unpause the contract
- Provides emergency response capability

#### Emergency Scenarios
- Suspicious activity detected
- Vulnerability discovered
- Market conditions are unstable
- System compromise suspected

### 3. Target Contract Whitelisting

To prevent arbitrary contract calls, the contract implements a whitelist system:

#### Features
- Only whitelisted contracts can be called in arbitrage routes
- Admin can add/remove targets from whitelist
- Batch operations for efficient whitelist management
- Prevents calls to malicious contracts

#### Default Whitelisted Contracts
- Aave V3 Pool
- Aerodrome Router
- Uniswap V3 SwapRouter02
- WETH
- USDC

### 4. Enhanced Input Validation

Multiple layers of input validation prevent invalid or malicious inputs:

#### Validations
- Zero address checks for all address parameters
- Minimum flash loan size to prevent dust attacks
- Maximum calls limit (20) to prevent gas griefing
- Minimum profit requirement to prevent useless transactions
- Call target whitelist validation

### 5. Reentrancy Protection

The contract uses OpenZeppelin's `ReentrancyGuard` to prevent reentrancy attacks:

#### Protection
- `nonReentrant` modifier on critical functions
- State changes follow checks-effects-interactions pattern
- Flash loan callback is protected against malicious reentrancy

### 6. Emergency Functions

The contract includes emergency response capabilities:

#### Withdraw Functions
- `withdrawToken()`: Rescue stuck ERC20 tokens (ADMIN only)
- `withdrawETH()`: Rescue stuck ETH (ADMIN only)

#### Role Management
- `grantRole()`: Grant roles to addresses (ADMIN only)
- `revokeRole()`: Revoke roles from addresses (ADMIN only)

#### Whitelist Management
- `addTargetToWhitelist()`: Add single target (ADMIN only)
- `removeTargetFromWhitelist()`: Remove target (ADMIN only)
- `batchAddTargetsToWhitelist()`: Add multiple targets (ADMIN only)

## Deployment Security

### Initial Deployment

1. **Deploy with admin address**:
   ```bash
   forge script script/Deploy.s.sol:Deploy \
     --rpc-url base \
     --broadcast \
     --verify \
     -vvvv
   ```

2. **Setup role separation**:
   ```bash
   forge script script/SetupRoles.s.sol:SetupRoles \
     --rpc-url base \
     --broadcast \
     -vvvv
   ```

### Role Configuration

For production deployment, configure roles as follows:

```bash
# .env configuration
PRIVATE_KEY=0x...  # Admin key (hardware wallet recommended)
OPERATOR_ADDRESS=0x...  # Bot address
PAUSER_ADDRESS=0x...  # Emergency response address
ARBITRAGE_CONTRACT_ADDRESS=0x...  # Deployed contract
```

### Recommended Setup

1. **Admin Role**: Use a hardware wallet or multisig
2. **Operator Role**: Use a dedicated hot wallet for the bot
3. **Pauser Role**: Use a separate hardware wallet for emergency response
4. **Consider using a timelock** for sensitive operations

## Security Testing

### Test Coverage

The contract includes comprehensive security tests:

- `FlashLoanArbitrage.t.sol`: Updated tests for new security features
- `SecurityHardening.t.sol`: Dedicated security tests

### Running Tests

```bash
# Run all tests
forge test --fork-url $BASE_RPC_URL -vvv

# Run only security tests
forge test --match-contract SecurityHardeningTest --fork-url $BASE_RPC_URL -vvv

# Run with gas reporting
forge test --fork-url $BASE_RPC_URL --gas-report
```

### Security Test Categories

1. **Access Control Tests**
   - Role assignment and revocation
   - Permission boundaries
   - Role separation enforcement

2. **Pausable Tests**
   - Pause/unpause functionality
   - Operation blocking when paused
   - Emergency scenario handling

3. **Whitelist Tests**
   - Target validation
   - Whitelist management
   - Bypass prevention

4. **Input Validation Tests**
   - Zero address checks
   - Amount validation
   - Call length limits
   - Profit requirements

5. **Reentrancy Tests**
   - Flash loan reentrancy protection
   - State consistency

6. **Emergency Function Tests**
   - Token recovery
   - ETH recovery
   - Role management

## Operational Security

### Monitoring

Implement comprehensive monitoring for:

- Failed arbitrage attempts
- Unusual gas usage
- Role changes
- Whitelist modifications
- Pause/unpause events
- Withdrawal operations

### Incident Response

Have a documented incident response plan:

1. **Detection**: Monitor for suspicious activity
2. **Response**: Use pause functionality immediately
3. **Investigation**: Analyze logs and transactions
4. **Recovery**: Revoke compromised roles, update whitelist
5. **Prevention**: Implement additional safeguards

### Key Management

- Store private keys securely (hardware wallets, HSMs)
- Use key management services for production
- Rotate keys regularly
- Implement key access logging
- Use multisig for critical operations

## Known Limitations

1. **Smart Contract Risk**: Despite security enhancements, smart contracts carry inherent risks
2. **Oracle Risk**: Price oracle manipulation could affect profitability calculations
3. **MEV Risk**: Front-running and sandwich attacks remain possible
4. **Protocol Risk**: Dependency on external protocols (Morpho, Aave, DEXs)
5. **Gas Price Risk**: High gas prices could make profitable routes unprofitable

## Security Recommendations

### Before Deployment

1. **Professional Audit**: Obtain a professional security audit
2. **Bug Bounty**: Consider running a bug bounty program
3. **Testing**: Test extensively on testnet with realistic scenarios
4. **Review**: Have the code reviewed by multiple security experts
5. **Monitoring**: Set up comprehensive monitoring and alerting

### After Deployment

1. **Start Small**: Begin with small amounts to test functionality
2. **Monitor Closely**: Watch for any unusual activity
3. **Gradual Scale**: Increase amounts gradually as confidence grows
4. **Regular Updates**: Keep dependencies updated
5. **Continuous Testing**: Regularly test emergency procedures

### Ongoing Security

1. **Regular Audits**: Schedule periodic security audits
2. **Stay Informed**: Keep up with security best practices
3. **Monitor Protocols**: Watch for changes in dependent protocols
4. **Update Whitelist**: Regularly review and update whitelist
5. **Test Incident Response**: Regularly test emergency procedures

## Security Contacts

For security concerns or vulnerabilities discovered:

1. **Do not exploit** any discovered vulnerabilities
2. **Report privately** to the project maintainers
3. **Allow time** for the issue to be fixed before public disclosure
4. **Follow responsible disclosure** practices

## Disclaimer

This contract is provided as-is for educational and development purposes. Even with security enhancements, it carries significant risks and should not be used with meaningful funds without:

- Professional security audit
- Extensive testing
- Proper risk management
- Legal and regulatory compliance
- Understanding of all risks involved

The authors and contributors accept no liability for any losses or damages resulting from the use of this contract.