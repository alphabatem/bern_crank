import WebSocket from "ws"
import {web3} from "@project-serum/anchor";
import {MarketTransaction} from "./market_transaction";

export class InboundTransactionListener {

	socket;

	mint;

	onTransaction = (txn) => {
		console.log("InboundTransactionListener", txn)
	}

	constructor(mint: web3.PublicKey, onTransaction = null) {
		this.mint = mint

		this.connect()

		if (onTransaction)
			this.onTransaction = onTransaction
	}

	connect(e = null) {
		this.socket = new WebSocket("wss://kiki-stream.hellomoon.io");
		this.socket.addEventListener("open", (e) => this.onOpen(e));
		this.socket.addEventListener("message", (e) => this.onMessage(e));
		this.socket.addEventListener("close", (e) => this.connect(e)); //Reconnect
	}

	onOpen(e) {
		console.log("Socket open")
		const msg = JSON.stringify({
			action: "subscribe",
			apiKey: "90371418-66a2-4d7e-912e-58fb05948a69",
			subscriptionId: "03f9e36a-b230-44bb-925e-31ccddd65089",
		})

		this.socket.send(msg);
	}

	onMessage(e) {
		if (e.data.indexOf("successfully subscribed") > -1)
			return //Subscribed

		const d = JSON.parse(e.data)
		this.onTransaction(new MarketTransaction(d))
	}
}