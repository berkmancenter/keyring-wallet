/**
 * Locally pinned standard W3C / DID / security JSON-LD contexts.
 *
 * Extracted verbatim from @credo-ts/core's bundled DEFAULT_CONTEXTS
 * (which credo does not export publicly). Served by the shared document
 * loader so that signing and verification never depend on network access
 * to w3.org / w3id.org — the same offline-determinism rule we apply to
 * the DTG custom contexts.
 */

export const CACHED_STANDARD_CONTEXTS: Record<string, object> = {
  "https://w3id.org/security/v1": {
    "@context": {
      "id": "@id",
      "type": "@type",
      "dc": "http://purl.org/dc/terms/",
      "sec": "https://w3id.org/security#",
      "xsd": "http://www.w3.org/2001/XMLSchema#",
      "EcdsaKoblitzSignature2016": "sec:EcdsaKoblitzSignature2016",
      "Ed25519Signature2018": "sec:Ed25519Signature2018",
      "EncryptedMessage": "sec:EncryptedMessage",
      "GraphSignature2012": "sec:GraphSignature2012",
      "LinkedDataSignature2015": "sec:LinkedDataSignature2015",
      "LinkedDataSignature2016": "sec:LinkedDataSignature2016",
      "CryptographicKey": "sec:Key",
      "authenticationTag": "sec:authenticationTag",
      "canonicalizationAlgorithm": "sec:canonicalizationAlgorithm",
      "cipherAlgorithm": "sec:cipherAlgorithm",
      "cipherData": "sec:cipherData",
      "cipherKey": "sec:cipherKey",
      "created": {
        "@id": "dc:created",
        "@type": "xsd:dateTime"
      },
      "creator": {
        "@id": "dc:creator",
        "@type": "@id"
      },
      "digestAlgorithm": "sec:digestAlgorithm",
      "digestValue": "sec:digestValue",
      "domain": "sec:domain",
      "encryptionKey": "sec:encryptionKey",
      "expiration": {
        "@id": "sec:expiration",
        "@type": "xsd:dateTime"
      },
      "expires": {
        "@id": "sec:expiration",
        "@type": "xsd:dateTime"
      },
      "initializationVector": "sec:initializationVector",
      "iterationCount": "sec:iterationCount",
      "nonce": "sec:nonce",
      "normalizationAlgorithm": "sec:normalizationAlgorithm",
      "owner": {
        "@id": "sec:owner",
        "@type": "@id"
      },
      "password": "sec:password",
      "privateKey": {
        "@id": "sec:privateKey",
        "@type": "@id"
      },
      "privateKeyPem": "sec:privateKeyPem",
      "publicKey": {
        "@id": "sec:publicKey",
        "@type": "@id"
      },
      "publicKeyBase58": "sec:publicKeyBase58",
      "publicKeyPem": "sec:publicKeyPem",
      "publicKeyWif": "sec:publicKeyWif",
      "publicKeyService": {
        "@id": "sec:publicKeyService",
        "@type": "@id"
      },
      "revoked": {
        "@id": "sec:revoked",
        "@type": "xsd:dateTime"
      },
      "salt": "sec:salt",
      "signature": "sec:signature",
      "signatureAlgorithm": "sec:signingAlgorithm",
      "signatureValue": "sec:signatureValue"
    }
  },
  "https://w3id.org/security/v2": {
    "@context": [
      {
        "@version": 1.1
      },
      "https://w3id.org/security/v1",
      {
        "AesKeyWrappingKey2019": "sec:AesKeyWrappingKey2019",
        "DeleteKeyOperation": "sec:DeleteKeyOperation",
        "DeriveSecretOperation": "sec:DeriveSecretOperation",
        "EcdsaSecp256k1Signature2019": "sec:EcdsaSecp256k1Signature2019",
        "EcdsaSecp256r1Signature2019": "sec:EcdsaSecp256r1Signature2019",
        "EcdsaSecp256k1VerificationKey2019": "sec:EcdsaSecp256k1VerificationKey2019",
        "EcdsaSecp256r1VerificationKey2019": "sec:EcdsaSecp256r1VerificationKey2019",
        "Ed25519Signature2018": "sec:Ed25519Signature2018",
        "Ed25519VerificationKey2018": "sec:Ed25519VerificationKey2018",
        "EquihashProof2018": "sec:EquihashProof2018",
        "ExportKeyOperation": "sec:ExportKeyOperation",
        "GenerateKeyOperation": "sec:GenerateKeyOperation",
        "KmsOperation": "sec:KmsOperation",
        "RevokeKeyOperation": "sec:RevokeKeyOperation",
        "RsaSignature2018": "sec:RsaSignature2018",
        "RsaVerificationKey2018": "sec:RsaVerificationKey2018",
        "Sha256HmacKey2019": "sec:Sha256HmacKey2019",
        "SignOperation": "sec:SignOperation",
        "UnwrapKeyOperation": "sec:UnwrapKeyOperation",
        "VerifyOperation": "sec:VerifyOperation",
        "WrapKeyOperation": "sec:WrapKeyOperation",
        "X25519KeyAgreementKey2019": "sec:X25519KeyAgreementKey2019",
        "allowedAction": "sec:allowedAction",
        "assertionMethod": {
          "@id": "sec:assertionMethod",
          "@type": "@id",
          "@container": "@set"
        },
        "authentication": {
          "@id": "sec:authenticationMethod",
          "@type": "@id",
          "@container": "@set"
        },
        "capability": {
          "@id": "sec:capability",
          "@type": "@id"
        },
        "capabilityAction": "sec:capabilityAction",
        "capabilityChain": {
          "@id": "sec:capabilityChain",
          "@type": "@id",
          "@container": "@list"
        },
        "capabilityDelegation": {
          "@id": "sec:capabilityDelegationMethod",
          "@type": "@id",
          "@container": "@set"
        },
        "capabilityInvocation": {
          "@id": "sec:capabilityInvocationMethod",
          "@type": "@id",
          "@container": "@set"
        },
        "caveat": {
          "@id": "sec:caveat",
          "@type": "@id",
          "@container": "@set"
        },
        "challenge": "sec:challenge",
        "ciphertext": "sec:ciphertext",
        "controller": {
          "@id": "sec:controller",
          "@type": "@id"
        },
        "delegator": {
          "@id": "sec:delegator",
          "@type": "@id"
        },
        "equihashParameterK": {
          "@id": "sec:equihashParameterK",
          "@type": "xsd:integer"
        },
        "equihashParameterN": {
          "@id": "sec:equihashParameterN",
          "@type": "xsd:integer"
        },
        "invocationTarget": {
          "@id": "sec:invocationTarget",
          "@type": "@id"
        },
        "invoker": {
          "@id": "sec:invoker",
          "@type": "@id"
        },
        "jws": "sec:jws",
        "keyAgreement": {
          "@id": "sec:keyAgreementMethod",
          "@type": "@id",
          "@container": "@set"
        },
        "kmsModule": {
          "@id": "sec:kmsModule"
        },
        "parentCapability": {
          "@id": "sec:parentCapability",
          "@type": "@id"
        },
        "plaintext": "sec:plaintext",
        "proof": {
          "@id": "sec:proof",
          "@type": "@id",
          "@container": "@graph"
        },
        "proofPurpose": {
          "@id": "sec:proofPurpose",
          "@type": "@vocab"
        },
        "proofValue": "sec:proofValue",
        "referenceId": "sec:referenceId",
        "unwrappedKey": "sec:unwrappedKey",
        "verificationMethod": {
          "@id": "sec:verificationMethod",
          "@type": "@id"
        },
        "verifyData": "sec:verifyData",
        "wrappedKey": "sec:wrappedKey"
      }
    ]
  },
  "https://w3id.org/security/suites/ed25519-2018/v1": {
    "@context": {
      "id": "@id",
      "type": "@type",
      "@protected": true,
      "proof": {
        "@id": "https://w3id.org/security#proof",
        "@type": "@id",
        "@container": "@graph"
      },
      "Ed25519VerificationKey2018": {
        "@id": "https://w3id.org/security#Ed25519VerificationKey2018",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "controller": {
            "@id": "https://w3id.org/security#controller",
            "@type": "@id"
          },
          "revoked": {
            "@id": "https://w3id.org/security#revoked",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
          },
          "publicKeyBase58": {
            "@id": "https://w3id.org/security#publicKeyBase58"
          }
        }
      },
      "Ed25519Signature2018": {
        "@id": "https://w3id.org/security#Ed25519Signature2018",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "challenge": "https://w3id.org/security#challenge",
          "created": {
            "@id": "http://purl.org/dc/terms/created",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
          },
          "domain": "https://w3id.org/security#domain",
          "expires": {
            "@id": "https://w3id.org/security#expiration",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
          },
          "nonce": "https://w3id.org/security#nonce",
          "proofPurpose": {
            "@id": "https://w3id.org/security#proofPurpose",
            "@type": "@vocab",
            "@context": {
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "assertionMethod": {
                "@id": "https://w3id.org/security#assertionMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "authentication": {
                "@id": "https://w3id.org/security#authenticationMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "capabilityInvocation": {
                "@id": "https://w3id.org/security#capabilityInvocationMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "capabilityDelegation": {
                "@id": "https://w3id.org/security#capabilityDelegationMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "keyAgreement": {
                "@id": "https://w3id.org/security#keyAgreementMethod",
                "@type": "@id",
                "@container": "@set"
              }
            }
          },
          "jws": {
            "@id": "https://w3id.org/security#jws"
          },
          "verificationMethod": {
            "@id": "https://w3id.org/security#verificationMethod",
            "@type": "@id"
          }
        }
      }
    }
  },
  "https://w3id.org/security/suites/x25519-2019/v1": {
    "@context": {
      "id": "@id",
      "type": "@type",
      "@protected": true,
      "X25519KeyAgreementKey2019": {
        "@id": "https://w3id.org/security#X25519KeyAgreementKey2019",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "controller": {
            "@id": "https://w3id.org/security#controller",
            "@type": "@id"
          },
          "revoked": {
            "@id": "https://w3id.org/security#revoked",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
          },
          "publicKeyBase58": {
            "@id": "https://w3id.org/security#publicKeyBase58"
          }
        }
      }
    }
  },
  "https://www.w3.org/2018/credentials/v1": {
    "@context": {
      "@version": 1.1,
      "@protected": true,
      "id": "@id",
      "type": "@type",
      "VerifiableCredential": {
        "@id": "https://www.w3.org/2018/credentials#VerifiableCredential",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "cred": "https://www.w3.org/2018/credentials#",
          "sec": "https://w3id.org/security#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
          "credentialSchema": {
            "@id": "cred:credentialSchema",
            "@type": "@id",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "cred": "https://www.w3.org/2018/credentials#",
              "JsonSchemaValidator2018": "cred:JsonSchemaValidator2018"
            }
          },
          "credentialStatus": {
            "@id": "cred:credentialStatus",
            "@type": "@id"
          },
          "credentialSubject": {
            "@id": "cred:credentialSubject",
            "@type": "@id"
          },
          "evidence": {
            "@id": "cred:evidence",
            "@type": "@id"
          },
          "expirationDate": {
            "@id": "cred:expirationDate",
            "@type": "xsd:dateTime"
          },
          "holder": {
            "@id": "cred:holder",
            "@type": "@id"
          },
          "issued": {
            "@id": "cred:issued",
            "@type": "xsd:dateTime"
          },
          "issuer": {
            "@id": "cred:issuer",
            "@type": "@id"
          },
          "issuanceDate": {
            "@id": "cred:issuanceDate",
            "@type": "xsd:dateTime"
          },
          "proof": {
            "@id": "sec:proof",
            "@type": "@id",
            "@container": "@graph"
          },
          "refreshService": {
            "@id": "cred:refreshService",
            "@type": "@id",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "cred": "https://www.w3.org/2018/credentials#",
              "ManualRefreshService2018": "cred:ManualRefreshService2018"
            }
          },
          "termsOfUse": {
            "@id": "cred:termsOfUse",
            "@type": "@id"
          },
          "validFrom": {
            "@id": "cred:validFrom",
            "@type": "xsd:dateTime"
          },
          "validUntil": {
            "@id": "cred:validUntil",
            "@type": "xsd:dateTime"
          }
        }
      },
      "VerifiablePresentation": {
        "@id": "https://www.w3.org/2018/credentials#VerifiablePresentation",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "cred": "https://www.w3.org/2018/credentials#",
          "sec": "https://w3id.org/security#",
          "holder": {
            "@id": "cred:holder",
            "@type": "@id"
          },
          "proof": {
            "@id": "sec:proof",
            "@type": "@id",
            "@container": "@graph"
          },
          "verifiableCredential": {
            "@id": "cred:verifiableCredential",
            "@type": "@id",
            "@container": "@graph"
          }
        }
      },
      "EcdsaSecp256k1Signature2019": {
        "@id": "https://w3id.org/security#EcdsaSecp256k1Signature2019",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "sec": "https://w3id.org/security#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
          "challenge": "sec:challenge",
          "created": {
            "@id": "http://purl.org/dc/terms/created",
            "@type": "xsd:dateTime"
          },
          "domain": "sec:domain",
          "expires": {
            "@id": "sec:expiration",
            "@type": "xsd:dateTime"
          },
          "jws": "sec:jws",
          "nonce": "sec:nonce",
          "proofPurpose": {
            "@id": "sec:proofPurpose",
            "@type": "@vocab",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "sec": "https://w3id.org/security#",
              "assertionMethod": {
                "@id": "sec:assertionMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "authentication": {
                "@id": "sec:authenticationMethod",
                "@type": "@id",
                "@container": "@set"
              }
            }
          },
          "proofValue": "sec:proofValue",
          "verificationMethod": {
            "@id": "sec:verificationMethod",
            "@type": "@id"
          }
        }
      },
      "EcdsaSecp256r1Signature2019": {
        "@id": "https://w3id.org/security#EcdsaSecp256r1Signature2019",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "sec": "https://w3id.org/security#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
          "challenge": "sec:challenge",
          "created": {
            "@id": "http://purl.org/dc/terms/created",
            "@type": "xsd:dateTime"
          },
          "domain": "sec:domain",
          "expires": {
            "@id": "sec:expiration",
            "@type": "xsd:dateTime"
          },
          "jws": "sec:jws",
          "nonce": "sec:nonce",
          "proofPurpose": {
            "@id": "sec:proofPurpose",
            "@type": "@vocab",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "sec": "https://w3id.org/security#",
              "assertionMethod": {
                "@id": "sec:assertionMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "authentication": {
                "@id": "sec:authenticationMethod",
                "@type": "@id",
                "@container": "@set"
              }
            }
          },
          "proofValue": "sec:proofValue",
          "verificationMethod": {
            "@id": "sec:verificationMethod",
            "@type": "@id"
          }
        }
      },
      "Ed25519Signature2018": {
        "@id": "https://w3id.org/security#Ed25519Signature2018",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "sec": "https://w3id.org/security#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
          "challenge": "sec:challenge",
          "created": {
            "@id": "http://purl.org/dc/terms/created",
            "@type": "xsd:dateTime"
          },
          "domain": "sec:domain",
          "expires": {
            "@id": "sec:expiration",
            "@type": "xsd:dateTime"
          },
          "jws": "sec:jws",
          "nonce": "sec:nonce",
          "proofPurpose": {
            "@id": "sec:proofPurpose",
            "@type": "@vocab",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "sec": "https://w3id.org/security#",
              "assertionMethod": {
                "@id": "sec:assertionMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "authentication": {
                "@id": "sec:authenticationMethod",
                "@type": "@id",
                "@container": "@set"
              }
            }
          },
          "proofValue": "sec:proofValue",
          "verificationMethod": {
            "@id": "sec:verificationMethod",
            "@type": "@id"
          }
        }
      },
      "RsaSignature2018": {
        "@id": "https://w3id.org/security#RsaSignature2018",
        "@context": {
          "@version": 1.1,
          "@protected": true,
          "challenge": "sec:challenge",
          "created": {
            "@id": "http://purl.org/dc/terms/created",
            "@type": "xsd:dateTime"
          },
          "domain": "sec:domain",
          "expires": {
            "@id": "sec:expiration",
            "@type": "xsd:dateTime"
          },
          "jws": "sec:jws",
          "nonce": "sec:nonce",
          "proofPurpose": {
            "@id": "sec:proofPurpose",
            "@type": "@vocab",
            "@context": {
              "@version": 1.1,
              "@protected": true,
              "id": "@id",
              "type": "@type",
              "sec": "https://w3id.org/security#",
              "assertionMethod": {
                "@id": "sec:assertionMethod",
                "@type": "@id",
                "@container": "@set"
              },
              "authentication": {
                "@id": "sec:authenticationMethod",
                "@type": "@id",
                "@container": "@set"
              }
            }
          },
          "proofValue": "sec:proofValue",
          "verificationMethod": {
            "@id": "sec:verificationMethod",
            "@type": "@id"
          }
        }
      },
      "proof": {
        "@id": "https://w3id.org/security#proof",
        "@type": "@id",
        "@container": "@graph"
      }
    }
  },
  "https://w3id.org/did/v1": {
    "@context": {
      "@protected": true,
      "id": "@id",
      "type": "@type",
      "alsoKnownAs": {
        "@id": "https://www.w3.org/ns/activitystreams#alsoKnownAs",
        "@type": "@id"
      },
      "assertionMethod": {
        "@id": "https://w3id.org/security#assertionMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "authentication": {
        "@id": "https://w3id.org/security#authenticationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityDelegation": {
        "@id": "https://w3id.org/security#capabilityDelegationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityInvocation": {
        "@id": "https://w3id.org/security#capabilityInvocationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "controller": {
        "@id": "https://w3id.org/security#controller",
        "@type": "@id"
      },
      "keyAgreement": {
        "@id": "https://w3id.org/security#keyAgreementMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "service": {
        "@id": "https://www.w3.org/ns/did#service",
        "@type": "@id",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "serviceEndpoint": {
            "@id": "https://www.w3.org/ns/did#serviceEndpoint",
            "@type": "@id"
          }
        }
      },
      "verificationMethod": {
        "@id": "https://w3id.org/security#verificationMethod"
      }
    }
  },
  "https://www.w3.org/ns/did/v1": {
    "@context": {
      "@protected": true,
      "id": "@id",
      "type": "@type",
      "alsoKnownAs": {
        "@id": "https://www.w3.org/ns/activitystreams#alsoKnownAs",
        "@type": "@id"
      },
      "assertionMethod": {
        "@id": "https://w3id.org/security#assertionMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "authentication": {
        "@id": "https://w3id.org/security#authenticationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityDelegation": {
        "@id": "https://w3id.org/security#capabilityDelegationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityInvocation": {
        "@id": "https://w3id.org/security#capabilityInvocationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "controller": {
        "@id": "https://w3id.org/security#controller",
        "@type": "@id"
      },
      "keyAgreement": {
        "@id": "https://w3id.org/security#keyAgreementMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "service": {
        "@id": "https://www.w3.org/ns/did#service",
        "@type": "@id",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "serviceEndpoint": {
            "@id": "https://www.w3.org/ns/did#serviceEndpoint",
            "@type": "@id"
          }
        }
      },
      "verificationMethod": {
        "@id": "https://w3id.org/security#verificationMethod"
      }
    }
  },
  "https://w3.org/ns/did/v1": {
    "@context": {
      "@protected": true,
      "id": "@id",
      "type": "@type",
      "alsoKnownAs": {
        "@id": "https://www.w3.org/ns/activitystreams#alsoKnownAs",
        "@type": "@id"
      },
      "assertionMethod": {
        "@id": "https://w3id.org/security#assertionMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "authentication": {
        "@id": "https://w3id.org/security#authenticationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityDelegation": {
        "@id": "https://w3id.org/security#capabilityDelegationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "capabilityInvocation": {
        "@id": "https://w3id.org/security#capabilityInvocationMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "controller": {
        "@id": "https://w3id.org/security#controller",
        "@type": "@id"
      },
      "keyAgreement": {
        "@id": "https://w3id.org/security#keyAgreementMethod",
        "@type": "@id",
        "@container": "@set"
      },
      "service": {
        "@id": "https://www.w3.org/ns/did#service",
        "@type": "@id",
        "@context": {
          "@protected": true,
          "id": "@id",
          "type": "@type",
          "serviceEndpoint": {
            "@id": "https://www.w3.org/ns/did#serviceEndpoint",
            "@type": "@id"
          }
        }
      },
      "verificationMethod": {
        "@id": "https://w3id.org/security#verificationMethod"
      }
    }
  }
} as const
