# Keyring & Witness Capabilities

## Key Definitions

- **Identity**: Any data associated with a user, including credentials, content, and behaviors
- **Privacy-preserving**: Sharing only the minimum information needed to complete a task while keeping personal data protected
- **Privacy by design**: Making user data ownership, control, and privacy central to the experience by building protections directly into product and system design

## Vision & Mission

**Vision**: Create a world where individuals have full ownership and control of their digital identities.

**Mission**: Build the foundational standards and infrastructure that enable technologies and applications to give users secure, privacy-preserving control over their identity and personal data.

## Why Now?

Several converging forces make this work urgent:

- Nearly universal smartphone and digital service access
- Rapid advancement of AI systems and synthetic identity risks
- Increasing fraud, impersonation, and trust challenges in digital interactions
- Growing user demand for privacy and data control

## Design Principles

Our approach is guided by these principles:

- **Privacy by Design**: Privacy, security, and user control are foundational elements, not add-on features
- **User Control and Agency**: Users maintain control over how their identity data is shared and used
- **Distributed Trust**: Trust is established through verifiable peer-to-peer relationships, not centralized authorities
- **Interoperability**: Identity credentials are portable and usable across systems and services
- **Minimum Disclosure**: Share only the information necessary to complete verification tasks

## About Keyring

Keyring is an open-source digital wallet developed at the Applied Social Media Lab (ASML) at Harvard's Berkman Klein Center. It enables individuals to:

- Create and manage decentralized identifiers (DIDs)
- Store verifiable credentials securely on their device
- Connect with other wallet holders through peer-to-peer exchange
- Exchange relationship credentials without centralized intermediaries
- Participate in witnessed credential exchanges

### The Two-Layer Trust System

Keyring enables a two-layer approach to digital identity:

1. **Proof-of-Personhood Credentials**: Establish unique human identity through peer-to-peer verification
2. **Verifiable Relationship Credentials**: Enable trusted social and professional relationships within the network

## Core Capabilities

### Relationship Credential Exchange (RCE) Protocol

The RCE Protocol defines standards for issuing, receiving, and verifying peer-to-peer relationship credentials. Through RCE:

- Individuals can issue cryptographically signed relationship credentials to others
- Users receive and store credentials issued by peers
- Credentials can be selectively disclosed when needed
- Authenticity is verified without relying on a centralized authority

**RCE establishes a portable, interoperable trust layer where credibility is based on direct, peer-issued attestations.**

### Witness Functionality

An entity can act as a "witness" to validate that connections occurred in its presence. The witness:

- Creates verified sessions when two people want to exchange credentials
- Verifies that both participants submitted valid credentials
- Issues Witnessed Credentials (VWCs) proving the exchange occurred
- Only sees that an exchange happened—not private information

This adds credibility and trust to connections while mitigating bad actors and fake accounts.

### Biometric Verification

Biometric verification ensures that the person operating the wallet is the legitimate owner:

- Uses device-native biometric validation (fingerprint, facial recognition)
- Biometric data is securely stored within the device's secure hardware enclave
- Biometric data never leaves the device
- Confirms the authorized wallet holder is initiating connections or issuing credentials

This mitigates risks of device theft, unauthorized access, or impersonation.

## How Witnessed Exchange Works

1. **Connect to Witness**: Scan the QR code to establish a DIDComm connection
2. **Meet Someone**: Find another participant you want to connect with
3. **Scan Each Other's QR Codes**: Exchange connection invitations
4. **Exchange Credentials**: Keyring automatically creates relationship credentials
5. **Witness Verification**: The witness verifies the exchange and issues VWCs to both parties

## Security & Privacy

- **End-to-End Encrypted**: All communication uses DIDComm encryption
- **Private by Design**: The witness doesn't see credential contents—only that an exchange occurred
- **Cryptographic Verification**: All credentials use digital signatures
- **Session-Based Challenges**: Prevents replay attacks and ensures freshness
- **On-Device Storage**: User data stays under user control, not on third-party servers

## Supported Protocols

- **DIDComm v2**: Secure, authenticated messaging
- **W3C Verifiable Credentials**: Standard credential format
- **Decentralized Trust Graph (DTG)**: Witnessed exchange protocol
- **Hardware Attestation** (optional): Device-backed signatures for enhanced security

## Ecosystem Alignment

Keyring is designed to interoperate with broader decentralized identity and trust ecosystems:

- Linux Foundation Decentralized Trust
- First Person Project
- Other open standards communities working toward user-owned identity

## Open Source & Technical Foundation

Keyring is Apache 2.0 licensed open source software, built with React Native to support both iOS and Android.

**Source Code:**

- [Keyring Wallet](https://github.com/berkmancenter/keyring-wallet) – The wallet interface and user experience
- [Keyring Bifold](https://github.com/berkmancenter/keyring-bifold) – Core logic and reusable components

The application builds on proven open source foundations:

- [Bifold Wallet](https://github.com/openwallet-foundation/bifold-wallet) from the OpenWallet Foundation
- [BC Wallet Mobile](https://github.com/bcgov/bc-wallet-mobile) from the Government of British Columbia, Canada

Our contributions to this ecosystem include:

- Drafting the initial [Decentralized Trust Graph credential specification](https://github.com/trustoverip/dtgwg-cred-tf), with input from the Linux Foundation Decentralized Trust's [Decentralized Trust Graph Working Group](https://lf-toip.atlassian.net/wiki/spaces/HOME/pages/257785857/Decentralized+Trust+Graph+Working+Group)
- Adding peer-to-peer relationship credential exchange to the wallet
- Developing and implementing the novel witnessed exchange protocol for the first time
- Creating a reusable module for local biometric attestation and verification on both iOS and Android

## Credential Types

- **Relationship Credential (VRC)**: Proves a relationship between two DIDs
- **Witness Credential (VWC)**: Attests that the witness observed a VRC exchange

## Technical Details

### DIDComm Message Types

The witness handles these message types:

- `witness-announcement`: Initial greeting when you connect
- `session-request`: Request to create a witnessed exchange session
- `session-challenge`: Cryptographic challenge for the session
- `submit-presentation`: Submit your credential for witness verification
- `verify-credential`: Request verification of a witnessed credential

## Common Questions

**Q: What information does the witness see?**
A: The witness only sees that two DIDs exchanged credentials. It doesn't see names, contact information, or any other personal data.

**Q: Can I use credentials offline?**
A: Yes! Once issued, credentials are stored in your wallet and can be presented offline.

**Q: What if I lose my phone?**
A: Your credentials are secured with your device's security features. You should back up your wallet recovery phrase.

**Q: Who can verify my witnessed credentials?**
A: Anyone can cryptographically verify that a credential was issued by this witness and hasn't been tampered with.

## Getting Help

If you encounter any issues:

- Check that your wallet is up to date
- Ensure you have a stable internet connection
- Try reconnecting to the witness
- Reach out to event organizers if problems persist
