import {Connection} from "@solana/web3.js";
import {MarketMaker} from "./market_maker/market_maker";
import {loadWalletKey} from "./market_maker/util";
import {web3} from "@project-serum/anchor";
import {WSOL} from "./token_swap/constants";


describe("Market Make", () => {
	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")

	const owner = loadWalletKey("./MmntXw42jkjfFQ9ju5vpucRL29Sos2ENmmSRk9cRwyG.json")

	it('Market makes', async () => {

		const config = {
			// mint: new web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"),
			// pool: new web3.PublicKey("Ebbpz3PWLaQxj2oyK967RgEPbcPypjQCoZ3tpB4fwLsk"), //Bern
			mint: new web3.PublicKey("2kMpEJCZL8vEDZe7YPLMCS9Y3WKSAMedXBn7xHPvsWvi"),
			pool: new web3.PublicKey("5EzrpD9fVSWjBigTkoZq9szD3RDRifFgZ3u9kHQWyKJ1"), //Solar
			outMint: WSOL,
			intervalTimeout: 5 * 60 * 1000,
			balanceThreshold: 0,
		}

		const bernSell = new MarketMaker(connection, owner, config)
		await bernSell.start()
	})
})