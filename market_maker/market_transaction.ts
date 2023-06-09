import {web3} from "@project-serum/anchor";

export class MarketTransaction {
	signature: string

	mintA: web3.PublicKey
	mintB: web3.PublicKey

	amountA = 0;
	amountB = 0;

	constructor(detail) {
		const [a, b] = detail
		this.signature = a.transactionId

		this.mintA = new web3.PublicKey(a.mint)
		this.mintB = new web3.PublicKey(b.mint)

		this.amountA = a.preBalance - a.postBalance
		this.amountB = b.preBalance - b.postBalance
	}

	isBuy(mint: web3.PublicKey) {
		return this.mintOut().equals(mint)
	}

	mintIn() {
		return this.amountA < 0 ? this.mintA : this.mintB
	}

	mintOut() {
		return this.amountA > 0 ? this.mintA : this.mintB
	}

	amountIn(transferTax = 0) {
		return Math.abs(this.amountA < 0 ? this.amountA : this.amountB)
	}

	amountOut(transferTax = 0) {
		return Math.abs(this.amountA > 0 ? this.amountA : this.amountB)
	}
}