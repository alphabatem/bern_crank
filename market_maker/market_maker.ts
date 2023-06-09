import {web3} from "@project-serum/anchor";
import {InboundTransactionListener} from "./inbound_transactions";
import {MarketTransaction} from "./market_transaction";
import {swapFluxbeamPool} from "./instructions";
import {TokenInput} from "../token_swap/layouts";
import {getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {WSOL} from "../token_swap/constants";
import {sendAndConfirmTransaction} from "@solana/web3.js";
import {getPool} from "./util";

//Reclaims tokens for holders

//Issues transfers

//Exchange for BONK

// BURN BONK

export class MarketMaker {

	/**
	 * NOTE: All calculations are done with token tax normalised on both sides
	 */

	listener: InboundTransactionListener

	owner: web3.Keypair

	//Token to market make
	mint: web3.PublicKey
	pool: web3.PublicKey

	outMint: web3.PublicKey = WSOL

	//The threshold above which we should sell tokens on a regular interval
	balanceThreshold = 0;

	timeout = 5 * 60 * 1000; //5 minutes

	//FluxBeam Pool to market make through
	poolData

	connection: web3.Connection

	currentBalance = 0

	sigs = {}

	interval = null

	constructor(connection: web3.Connection, owner: web3.Keypair, opts) {
		this.mint = opts.mint
		this.pool = opts.pool
		this.outMint = opts.outMint
		this.timeout = opts.intervalTimeout
		this.balanceThreshold = opts.balanceThreshold

		this.connection = connection
		this.owner = owner
		this.configure()
	}

	async configure() {
		getPool(this.connection, this.pool).then(r => {
			this.poolData = r
		}).catch(e => {
			console.error("Failed to get pool", e)
		})
	}

	async start() {
		this.interval = setInterval(() => {
			this.onInterval()
		}, this.timeout)

		await this.getCurrentBalance()
		this.listener = new InboundTransactionListener(this.mint, (txn) => this.onTransaction(txn))
	}

	stop() {
		clearInterval(this.interval)
	}

	async getCurrentBalance() {
		const r = await this.connection.getTokenAccountBalance(getAssociatedTokenAddressSync(this.mint, this.owner.publicKey, false, TOKEN_2022_PROGRAM_ID))
		this.currentBalance = r?.value?.uiAmount
		console.log("Current Balance: ", this.currentBalance)
	}

	/**
	 * Called each interval of the timer
	 */
	async onInterval() {
		await this.getCurrentBalance() //Refresh balance
		if (this.currentBalance <= this.balanceThreshold) {
			return
		}

		const variance = this.balanceThreshold - this.currentBalance
		console.log("Balance above threshold", variance)

		const cycleSell = variance / 5 // Sell 20% of the amount above the variance

		const sig = await this._sellTokens(cycleSell)
		console.log("TIMER-SELL: ", sig)
	}

	/**
	 * Called each time a new transaction is made on the pool
	 *
	 * @param txn
	 */
	onTransaction(txn: MarketTransaction) {
		if (this.sigs[txn.signature])
			return

		if (txn.isBuy(this.mint)) {
			this.onBuy(txn).catch(e => console.log("Failed to Buy", e))
		} else {
			this.onSell(txn).catch(e => console.log("Failed to Sell", e))
		}
	}

	//Called when a new BUY transaction is detected
	async onBuy(txn: MarketTransaction) {
		console.log("BUY", txn.amountOut())
		const sig = await this._sellTokens(Math.round(txn.amountOut() / 3))
		console.log("COUNTER-SELL: ", sig)
	}

	addSig(sig) {
		if (Object.keys(this.sigs).length > 50)
			this.sigs = {}

		this.sigs[sig] = true
	}

	//Called when a new SELL transaction is detected
	async onSell(txn: MarketTransaction) {
		console.log("SELL", (txn.amountIn() / (1 - 0.069)))

		//Currently we arent doing anything when someone sells
	}


	/**
	 * Sells tokens via fluxbeam pool
	 * @param amount
	 */
	async _sellTokens(amount) {
		const minOut = 0
		const swapTxn = await swapFluxbeamPool(
			this.connection,
			this.owner.publicKey,
			this.poolData,
			new TokenInput(this.mint, 0, TOKEN_2022_PROGRAM_ID),
			new TokenInput(this.outMint, 0, TOKEN_PROGRAM_ID),
			amount,
			minOut
		)

		const sig = await sendAndConfirmTransaction(this.connection, swapTxn, [this.owner], {skipPreflight: true})
		this.addSig(sig)
		return sig
	}
}