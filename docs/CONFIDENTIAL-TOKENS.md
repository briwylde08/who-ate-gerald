# How a confidential token transfer works on Stellar

This explanation uses XLM as the example asset, but the confidential-token wrapper can accept any SEP-41 token.

A confidential-token wrapper does not make the underlying XLM itself private. Instead, it holds real XLM in a shared contract pool and issues confidential claims representing each participant's share of that pool.

A transfer therefore changes the ownership of claims inside the wrapper. The underlying XLM stays in the pool until someone withdraws it.

## The three places value lives

### 1. Your regular balance

This is real XLM held by your Stellar account.

- Your wallet displays it.
- Its amount is public.
- Deposits subtract from it.
- Withdrawals add to it.

### 2. The contract pool

The confidential-token contract holds all deposited XLM in one shared pool. Every deposit adds real XLM to this balance. That XLM stays in the pool until someone withdraws it.

The pool's total balance is public, but its internal ownership breakdown is not. An observer can see how much XLM the wrapper holds without seeing how much belongs to each participant.

### 3. Your confidential claims

The contract maintains an internal ledger entry for every registered participant. Your entry contains:

- Your public keys
- Your auditor configuration
- A pending balance
- A spendable balance

The balance fields do not contain readable numbers. Each is stored as a Pedersen commitment: a balance combined with a large random secret and represented as a curve point.

Anyone can read the commitment bytes onchain, but those bytes do not reveal the balance. Only someone with the opening (the original amount and its random secret) can interpret the commitment.

Your device must therefore track the information needed to open and update your commitments.

## Pending and spendable balances

Each account has two confidential balance fields.

### Pending: your inbox

- Deposits and incoming transfers arrive in your pending balance.
- Other participants can increase this balance by paying you, but they cannot spend from it or affect your spendable balance.
- You cannot spend directly from pending. You must first merge the entire pending balance into spendable.

### Spendable: your pocket

- Transfers and withdrawals come from your spendable balance.
- Only actions authorized by you can change it.

### Why the balances are separated

A zero-knowledge proof is valid only against the exact commitment used when the proof was created.

Suppose incoming transfers went directly into your spendable balance. You might begin constructing a payment proof, only for someone else to send you money before you submit it. That incoming payment would change your commitment and invalidate your proof.

An attacker could exploit this by repeatedly sending tiny payments and preventing your transactions from completing.

The pending balance absorbs changes caused by the outside world. Your spendable balance changes only when you act.

## The complete transfer flow

A confidential-token payment has six steps:

1. **Register**: Each participant registers with the wrapper contract. (1 tx each)
2. **Deposit**: The sender deposits public XLM into the contract pool.
3. **Merge**: The sender moves their pending claim into their spendable balance.
4. **Transfer**: The sender confidentially transfers part of their spendable claim to the receiver's pending balance.
5. **Merge**: The receiver moves the incoming claim from pending to spendable.
6. **Withdraw**: The receiver may exchange part of their confidential claim for regular XLM.

### Step 1: Register

Each participant registers once per wrapper contract.

Registration binds the participant's public keys and auditor information to their account in the contract's internal ledger. It also creates their pending and spendable commitments, both initialized to zero.

The participant submits an ordinary Stellar transaction containing the required keys and a small zero-knowledge proof showing that the registration information is valid.

The sender and receiver register independently. They do not need to register in the same transaction.

On an explorer, registration looks like an ordinary contract invocation.

### Step 2: Deposit

```
deposit(from, to, amount)
```

The sender deposits regular XLM into the wrapper contract.

The amount is public. Observers can see:

- Who deposited
- Which account received the claim
- When the deposit happened
- How much XLM was deposited

The deposited XLM leaves the sender's regular account and enters the contract pool. In exchange, the contract adds an equal claim to the recipient's pending commitment.

It is useful to think of this as an exchange rather than a simple transfer:

> Public XLM into the pool ⇄ confidential claim issued to the depositor

The XLM remains real XLM. What becomes confidential is the ownership claim representing who controls that portion of the pool.

### Step 3: Merge pending into spendable

```
merge(account)
```

The sender must move their pending balance into their spendable balance before they can make a confidential payment.

Only the account owner can authorize this operation.

The merge is all or nothing. It combines the entire pending commitment with the spendable commitment through homomorphic addition: the contract can combine two hidden values without learning either value or their sum.

Conceptually:

> sealed pending balance + sealed spendable balance
> = sealed new spendable balance

After the merge:

- Pending returns to zero.
- Spendable contains the combined balance.
- No amount is revealed.

### Step 4: Make a confidential transfer

```
confidential_transfer(from, to, data)
```

The sender's device performs the private arithmetic and constructs a zero-knowledge proof.

The proof demonstrates that:

- The sender had enough spendable value.
- The sender's balance was reduced correctly.
- The receiver's balance was increased by the same amount.
- No value was created or destroyed.

The proof does not reveal the transfer amount or either participant's balance.

When the transaction confirms:

- The sender's spendable commitment decreases.
- The receiver's pending commitment increases.
- The underlying XLM remains in the shared contract pool.

The amount is also encrypted for the parties that need to read it:

- Once for the receiver's viewing key, so the receiver can determine what they received
- Once for the wrapper's designated auditor, providing the contract's compliance channel

To everyone else, the encrypted values and commitments appear as meaningless bytes.

The transaction record still reveals that the sender interacted with the receiver and when the transfer happened. It hides the amount and balances, not necessarily the participants' identities.

### Step 5: The receiver merges

The transferred claim belongs to the receiver as soon as the confidential transfer confirms, but it initially sits in the receiver's pending balance.

The receiver must authorize a merge before spending or withdrawing it.

This is the same operation the sender performed earlier:

> receiver pending → receiver spendable

Receiving is passive. Using the received value requires the receiver to merge it at a time they choose.

### Step 6: Withdraw

```
withdraw(from, to, amount, proof)
```

A withdrawal exchanges part of a confidential claim for regular XLM.

The withdrawal amount becomes public again.

The withdrawing participant supplies a proof showing that their spendable commitment contains enough value. When the transaction succeeds:

- Their spendable claim decreases.
- Real XLM leaves the contract pool.
- The XLM enters the destination account's regular balance.

Inside the wrapper, value can circulate confidentially. To use that XLM elsewhere on Stellar, the holder must withdraw it through this public boundary.

## What an observer can see

### Deposits and withdrawals

The wrapper boundary is public. Observers can see:

- Who acted
- When they acted
- The deposited or withdrawn amount
- The affected public accounts

### Confidential transfers

Observers can see:

- That a contract call occurred
- Who authorized it
- Which ledger entries were affected
- When it happened

They cannot see:

- The transfer amount
- The sender's balance
- The receiver's balance

### Merges

Observers can see that an account merged its pending balance, but not the amount merged.

One small exception is that an empty pending commitment may be recognizable as empty because zero is represented by the curve's identity point.

### Ledger entries

The commitments are public onchain data, but their contents remain hidden without the openings.

An observer can read the bytes without learning the balances they represent.

### The contract pool

Anyone can see the total amount locked in the wrapper.

They cannot determine how that total is divided among participants by reading the confidential ledger alone.

## The six verbs

The entire lifecycle can be reduced to six actions:

> Register once
> Public value in
> Merge
> Hidden transfer
> Merge
> Public value out

Deposits and withdrawals reveal amounts. Activity inside the wrapper does not.

## Why many wrapper contracts exist today

During the developer-preview phase, different teams are deploying their own confidential-token wrapper contracts. That is expected.

The contracts are currently unaudited, the deployments are on Testnet, and the purpose of the preview is experimentation. A demo team may deploy one wrapper, a developer may create another through an advanced interface, and a game such as Ember may use its own deployment.

There is little reason to coordinate around a canonical contract while every deployment is temporary and experimental.

## What maturity may look like

Mainnet will probably not converge on literally one wrapper for every asset. A more likely outcome is a small number of well-known, audited deployments for each major asset.

Two competing forces shape that outcome.

### Pressure toward convergence

Confidential value is most useful when counterparties share the same wrapper. A claim inside one wrapper cannot automatically circulate inside an unrelated wrapper. A wrapper with one participant is effectively a private island. This creates pressure for wallets, applications, and users to converge around widely supported deployments. A major asset might therefore develop a commonly recognized wrapper in much the same way that users recognize canonical asset contracts.

There is one important difference: a Stellar Asset Contract is derived through a protocol-defined mechanism. A confidential wrapper does not currently have that property.

Its canonical status would instead come from social and ecosystem consensus, including:

- Who deployed it
- Which audits it completed
- Which wallets support it
- Which applications integrate it
- Which compliance rules it applies

### Legitimate reasons for multiple wrappers

Different wrappers may represent genuinely different products.

For example, one wrapper might be permissionless while another requires every participant to complete identity verification. Other wrappers may use:

- Allowlists
- Blocklists
- Account freezing
- Different auditors
- Different administrative controls
- Different compliance policies

Because the auditor and policy configuration apply to a particular wrapper instance, different institutional or regulatory arrangements may require separate deployments. The eventual ecosystem may therefore contain a handful of recognized wrappers per major asset, differentiated by compliance profile. Random deployments could remain technically possible, but they would have limited usefulness unless wallets and counterparties chose to support them. This isolation can also be beneficial. A vulnerability or configuration problem in one wrapper is contained within that wrapper rather than automatically affecting every confidential version of the asset.

## The key mental model

Real XLM enters a public shared pool.

Inside the wrapper, participants hold confidential claims against that pool. Transfers privately reassign those claims without moving the underlying XLM.

Pending balances receive value. Spendable balances send value. The separation ensures that another person cannot invalidate your in-progress proof merely by paying you.

When someone wants ordinary XLM again, they publicly exchange part of their confidential claim for XLM from the pool.
