;; MarketplaceEscrow.clar
;; Robust escrow for bandwidth transactions, with timed releases, partial refunds, multi-signature confirmations,
;; fee structures, and integration with user registry for reputation updates.

;; Constants
(define-constant ERR-NOT-REGISTERED u200)
(define-constant ERR-INSUFFICIENT-FUNDS u201)
(define-constant ERR-INVALID-AMOUNT u202)
(define-constant ERR-ESCROW-EXISTS u203)
(define-constant ERR-NOT-SELLER u204)
(define-constant ERR-NOT-BUYER u205)
(define-constant ERR-ESCROW-NOT-FOUND u206)
(define-constant ERR-INVALID-STATE u207)
(define-constant ERR-TIMEOUT-NOT-REACHED u208)
(define-constant ERR-ALREADY-CONFIRMED u209)
(define-constant ERR-INVALID-FEE u210)
(define-constant STATE-PENDING u1)
(define-constant STATE-ACTIVE u2)
(define-constant STATE-COMPLETED u3)
(define-constant STATE-DISPUTED u4)
(define-constant STATE-REFUNDED u5)
(define-constant PLATFORM-FEE-PCT u5)  ;; 0.5%
(define-constant MAX-ESCROW-DURATION u144)  ;; ~1 day in blocks

;; Data Maps
(define-map escrows
  uint  ;; escrow-id
  {
    seller: principal,
    buyer: principal,
    amount: uint,
    fee: uint,
    start-time: uint,
    duration: uint,
    state: uint,
    listing-id: uint,
    confirmations: (list 2 principal),  ;; Multi-sig like, buyer and seller confirm
    refund-amount: uint
  }
)

(define-map escrow-payments
  uint
  {
    paid: bool,
    timestamp: uint
  }
)

(define-map escrow-metadata
  uint
  {
    description: (string-utf8 512),
    terms: (string-utf8 1024)
  }
)

;; Private Functions
(define-private (calculate-fee (amount uint))
  (/ (* amount PLATFORM-FEE-PCT) u1000)
)

(define-private (transfer-stx (amount uint) (recipient principal))
  (try! (stx-transfer? amount tx-sender recipient))
  (ok true)
)

(define-private (update-reputation (user principal) (delta int))
  ;; Assume UserRegistry contract exists, call it
  (contract-call? .UserRegistry update-reputation user delta)
)

;; Public Functions
(define-public (create-escrow (listing-id uint) (amount uint) (duration uint) (description (string-utf8 512)) (terms (string-utf8 1024)))
  (let ((escrow-id (+ (var-get last-escrow-id) u1))
        (fee (calculate-fee amount)))
    (asserts! (is-some (contract-call? .UserRegistry get-user tx-sender)) (err ERR-NOT-REGISTERED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= duration MAX-ESCROW-DURATION) (err ERR-INVALID-INPUT))
    (try! (transfer-stx (+ amount fee) (as-contract tx-sender)))  ;; Lock funds
    (map-set escrows escrow-id
      {
        seller: (unwrap-panic (contract-call? .BandwidthListing get-listing-owner listing-id)),  ;; Assume integration
        buyer: tx-sender,
        amount: amount,
        fee: fee,
        start-time: block-height,
        duration: duration,
        state: STATE-PENDING,
        listing-id: listing-id,
        confirmations: (list ),
        refund-amount: u0
      }
    )
    (map-set escrow-metadata escrow-id {description: description, terms: terms})
    (var-set last-escrow-id escrow-id)
    (ok escrow-id)
  )
)

(define-public (confirm-delivery (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow
    (begin
      (asserts! (or (is-eq tx-sender (get buyer escrow)) (is-eq tx-sender (get seller escrow))) (err ERR-NOT-OWNER))
      (asserts! (is-eq (get state escrow) STATE-ACTIVE) (err ERR-INVALID-STATE))
      (asserts! (not (is-some (index-of (get confirmations escrow) tx-sender))) (err ERR-ALREADY-CONFIRMED))
      (let ((new-confirmations (append (get confirmations escrow) tx-sender)))
        (if (is-eq (len new-confirmations) u2)
          (begin
            (map-set escrows escrow-id (merge escrow {state: STATE-COMPLETED, confirmations: new-confirmations}))
            (as-contract (try! (transfer-stx (get amount escrow) (get seller escrow))))
            (as-contract (try! (transfer-stx (get fee escrow) (as-contract tx-sender))))  ;; Platform keeps fee
            (update-reputation (get seller escrow) 100)
            (update-reputation (get buyer escrow) 50)
            (ok true)
          )
          (begin
            (map-set escrows escrow-id (merge escrow {confirmations: new-confirmations}))
            (ok false)  ;; Not yet complete
          )
        )
      )
    )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (activate-escrow (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow
    (begin
      (asserts! (is-eq tx-sender (get seller escrow)) (err ERR-NOT-SELLER))
      (asserts! (is-eq (get state escrow) STATE-PENDING) (err ERR-INVALID-STATE))
      (map-set escrows escrow-id (merge escrow {state: STATE-ACTIVE}))
      (ok true)
    )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (request-refund (escrow-id uint) (refund-amount uint))
  (match (map-get? escrows escrow-id)
    escrow
    (begin
      (asserts! (is-eq tx-sender (get buyer escrow)) (err ERR-NOT-BUYER))
      (asserts! (or (is-eq (get state escrow) STATE-ACTIVE) (is-eq (get state escrow) STATE-PENDING)) (err ERR-INVALID-STATE))
      (asserts! (<= refund-amount (get amount escrow)) (err ERR-INVALID-AMOUNT))
      (map-set escrows escrow-id (merge escrow {state: STATE-DISPUTED, refund-amount: refund-amount}))
      (ok true)
    )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (approve-refund (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow
    (begin
      (asserts! (is-eq tx-sender (get seller escrow)) (err ERR-NOT-SELLER))
      (asserts! (is-eq (get state escrow) STATE-DISPUTED) (err ERR-INVALID-STATE))
      (let ((refund (get refund-amount escrow)))
        (as-contract (try! (transfer-stx refund (get buyer escrow))))
        (as-contract (try! (transfer-stx (- (get amount escrow) refund) (get seller escrow))))
        (map-set escrows escrow-id (merge escrow {state: STATE-REFUNDED}))
        (update-reputation (get seller escrow) -50)
        (ok true)
      )
    )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (timeout-release (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow
    (begin
      (asserts! (> (- block-height (get start-time escrow)) (get duration escrow)) (err ERR-TIMEOUT-NOT-REACHED))
      (asserts! (is-eq (get state escrow) STATE-ACTIVE) (err ERR-INVALID-STATE))
      (as-contract (try! (transfer-stx (get amount escrow) (get seller escrow))))
      (map-set escrows escrow-id (merge escrow {state: STATE-COMPLETED}))
      (update-reputation (get seller escrow) 20)
      (ok true)
    )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

;; Read-Only Functions
(define-read-only (get-escrow (escrow-id uint))
  (map-get? escrows escrow-id)
)

(define-read-only (get-escrow-metadata (escrow-id uint))
  (map-get? escrow-metadata escrow-id)
)

(define-read-only (get-escrow-state (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow (ok (get state escrow))
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-read-only (calculate-platform-fee (amount uint))
  (ok (calculate-fee amount))
)

;; Variables
(define-data-var last-escrow-id uint u0)