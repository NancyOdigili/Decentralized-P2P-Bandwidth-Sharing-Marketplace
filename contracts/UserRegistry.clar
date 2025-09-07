;; UserRegistry.clar
;; Sophisticated user registry for BandShare, handling roles, profiles, reputation, KYC-like verification,
;; multi-factor auth hints, and activity tracking for providers and consumers.

;; Constants
(define-constant ERR-ALREADY-REGISTERED u100)
(define-constant ERR-NOT-OWNER u101)
(define-constant ERR-INVALID-ROLE u102)
(define-constant ERR-INVALID-INPUT u103)
(define-constant ERR-NOT-REGISTERED u104)
(define-constant ERR-REPUTATION-OVERFLOW u105)
(define-constant ERR-INVALID-STATUS u106)
(define-constant ERR-MAX-ACTIVITIES-REACHED u107)
(define-constant MAX-PROFILE-LENGTH u256)
(define-constant MAX-ACTIVITIES u50)
(define-constant ROLE-PROVIDER u1)
(define-constant ROLE-CONSUMER u2)
(define-constant ROLE-ARBITRATOR u3)
(define-constant STATUS-ACTIVE u1)
(define-constant STATUS-SUSPENDED u2)
(define-constant STATUS-BANNED u3)

;; Data Maps
(define-map users
  principal
  {
    role: uint,
    profile: (string-utf8 256),  ;; Bio or description
    location: (buff 32),  ;; Geohash or encrypted location
    reputation: uint,  ;; Score from 0 to 10000
    registration-time: uint,
    last-active: uint,
    status: uint,
    verification-level: uint  ;; 0: none, 1: email, 2: KYC
  }
)

(define-map user-activities
  { user: principal, index: uint }
  {
    activity-type: uint,  ;; 1: listing created, 2: purchase, 3: dispute, etc.
    timestamp: uint,
    reference-id: uint  ;; Link to listing or escrow ID
  }
)

(define-map user-auth-hints
  principal
  {
    hint1: (buff 64),
    hint2: (buff 64)
  }
)

(define-map user-collaborators
  { user: principal, collaborator: principal }
  {
    permission-level: uint,  ;; 1: view, 2: manage listings, 3: full
    added-at: uint
  }
)

;; Private Functions
(define-private (is-valid-role (role uint))
  (or (is-eq role ROLE-PROVIDER) (is-eq role ROLE-CONSUMER) (is-eq role ROLE-ARBITRATOR))
)

(define-private (is-valid-status (status uint))
  (or (is-eq status STATUS-ACTIVE) (is-eq status STATUS-SUSPENDED) (is-eq status STATUS-BANNED))
)

(define-private (get-user-activity-count (user principal))
  (fold + (map get-activity-index (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9 u10 u11 u12 u13 u14 u15 u16 u17 u18 u19 u20 u21 u22 u23 u24 u25 u26 u27 u28 u29 u30 u31 u32 u33 u34 u35 u36 u37 u38 u39 u40 u41 u42 u43 u44 u45 u46 u47 u48 u49)) u0)
)

(define-private (get-activity-index (index uint))
  (match (map-get? user-activities {user: tx-sender, index: index})
    entry 1
    0
  )
)

;; Public Functions
(define-public (register-user (role uint) (profile (string-utf8 256)) (location (buff 32)))
  (begin
    (asserts! (is-valid-role role) (err ERR-INVALID-ROLE))
    (asserts! (<= (len profile) MAX-PROFILE-LENGTH) (err ERR-INVALID-INPUT))
    (asserts! (is-none (map-get? users tx-sender)) (err ERR-ALREADY-REGISTERED))
    (map-set users tx-sender
      {
        role: role,
        profile: profile,
        location: location,
        reputation: u5000,  ;; Start at neutral
        registration-time: block-height,
        last-active: block-height,
        status: STATUS-ACTIVE,
        verification-level: u0
      }
    )
    (ok true)
  )
)

(define-public (update-profile (new-profile (string-utf8 256)) (new-location (buff 32)))
  (match (map-get? users tx-sender)
    user
    (begin
      (asserts! (<= (len new-profile) MAX-PROFILE-LENGTH) (err ERR-INVALID-INPUT))
      (map-set users tx-sender
        (merge user {profile: new-profile, location: new-location, last-active: block-height})
      )
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (set-auth-hints (hint1 (buff 64)) (hint2 (buff 64)))
  (match (map-get? users tx-sender)
    user
    (begin
      (map-set user-auth-hints tx-sender {hint1: hint1, hint2: hint2})
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (add-collaborator (collaborator principal) (permission-level uint))
  (match (map-get? users tx-sender)
    user
    (begin
      (asserts! (<= permission-level u3) (err ERR-INVALID-INPUT))
      (asserts! (is-none (map-get? user-collaborators {user: tx-sender, collaborator: collaborator})) (err ERR-ALREADY-REGISTERED))
      (map-set user-collaborators {user: tx-sender, collaborator: collaborator}
        {permission-level: permission-level, added-at: block-height}
      )
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (remove-collaborator (collaborator principal))
  (match (map-get? users tx-sender)
    user
    (begin
      (asserts! (is-some (map-get? user-collaborators {user: tx-sender, collaborator: collaborator})) (err ERR-NOT-REGISTERED))
      (map-delete user-collaborators {user: tx-sender, collaborator: collaborator})
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (update-reputation (user principal) (delta int))
  (match (map-get? users user)
    entry
    (let ((new-rep (if (> delta 0)
                     (+ (get reputation entry) (to-uint delta))
                     (- (get reputation entry) (to-uint (* delta -1)))))
         )
      (asserts! (<= new-rep u10000) (err ERR-REPUTATION-OVERFLOW))
      (asserts! (>= new-rep u0) (err ERR-REPUTATION-OVERFLOW))
      (map-set users user (merge entry {reputation: new-rep}))
      (ok new-rep)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (update-status (user principal) (new-status uint))
  (match (map-get? users tx-sender)
    caller
    (match (map-get? users user)
      target
      (begin
        (asserts! (is-eq (get role caller) ROLE-ARBITRATOR) (err ERR-NOT-OWNER))  ;; Only arbitrators can change status
        (asserts! (is-valid-status new-status) (err ERR-INVALID-STATUS))
        (map-set users user (merge target {status: new-status, last-active: block-height}))
        (ok true)
      )
      (err ERR-NOT-REGISTERED)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (log-activity (activity-type uint) (reference-id uint))
  (match (map-get? users tx-sender)
    user
    (let ((count (get-user-activity-count tx-sender)))
      (asserts! (< count MAX-ACTIVITIES) (err ERR-MAX-ACTIVITIES-REACHED))
      (map-set user-activities {user: tx-sender, index: count}
        {activity-type: activity-type, timestamp: block-height, reference-id: reference-id}
      )
      (map-set users tx-sender (merge user {last-active: block-height}))
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (upgrade-verification (new-level uint))
  (match (map-get? users tx-sender)
    user
    (begin
      (asserts! (> new-level (get verification-level user)) (err ERR-INVALID-INPUT))
      (asserts! (<= new-level u2) (err ERR-INVALID-INPUT))
      (map-set users tx-sender (merge user {verification-level: new-level}))
      (ok true)
    )
    (err ERR-NOT-REGISTERED)
  )
)

;; Read-Only Functions
(define-read-only (get-user (user principal))
  (map-get? users user)
)

(define-read-only (get-user-auth-hints (user principal))
  (map-get? user-auth-hints user)
)

(define-read-only (get-collaborator (user principal) (collaborator principal))
  (map-get? user-collaborators {user: user, collaborator: collaborator})
)

(define-read-only (get-activity (user principal) (index uint))
  (map-get? user-activities {user: user, index: index})
)

(define-read-only (is-registered (user principal))
  (is-some (map-get? users user))
)

(define-read-only (has-role (user principal) (role uint))
  (match (map-get? users user)
    entry (is-eq (get role entry) role)
    false
  )
)

(define-read-only (get-reputation (user principal))
  (match (map-get? users user)
    entry (ok (get reputation entry))
    (err ERR-NOT-REGISTERED)
  )
)

(define-read-only (get-status (user principal))
  (match (map-get? users user)
    entry (ok (get status entry))
    (err ERR-NOT-REGISTERED)
  )
)