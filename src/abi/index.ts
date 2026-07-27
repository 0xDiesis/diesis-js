// Re-exported wholesale rather than as a named list. The upstream barrel is
// generated from the contract artifacts, so any list restated here falls behind
// the moment a contract is added — with no error at either end. Forwarding makes
// this barrel track generation by construction.
export * from '@diesis/contracts/abi'
