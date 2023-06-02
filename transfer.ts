import {Connection} from "@solana/web3.js";
import * as anchor from "@project-serum/anchor";
import {TokenSwapLayout} from "./token_swap/layouts";

const axios = require("axios");
const fs = require("fs");
const {BN} = require('bn.js');
const {LAMPORTS_PER_SOL} = require("@solana/web3.js");

const tokenMint = "CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo";
// const TOTAL_SEND = 2286.7;
const TOTAL_SEND = 3692;
const MINT_SUPPLY = 1025632817;

const PER_TOKEN = TOTAL_SEND / MINT_SUPPLY;

async function main() {
	let holders = await getAllTokenHolders();
	const poolHolders = await getTokenPoolAccounts().catch(e => {
		console.error(e)
	});

	let totalRewards = 0;
	let totalBern = 0;

	let currentHolders = holders.map(holder => {
		if (poolHolders[holder.address.toString()]) {
			console.log("Holder Address: ", holder.address)
			return  //Pool address
		}

		let bernAmount = holder.amount / Math.pow(10, 5);
		totalBern += bernAmount;

		let solReward = (PER_TOKEN * bernAmount) * LAMPORTS_PER_SOL;

		totalRewards += solReward;

		return {
			...holder,
			bernAmount: bernAmount,
			perToken: PER_TOKEN,
			solReward: solReward,
		}
	});

	let list = {
		"wallets": currentHolders
	};

	console.log(list);
	console.log(`holder count: ${currentHolders.length}`);
	console.log(`total rewards: ${totalRewards}`);
	console.log(`total bern: ${totalBern}`);

	let data = JSON.stringify(list, null, 2);
	fs.writeFileSync('currentHolders.json', data);
}

async function getAllTokenHolders() {
	let page = 0;
	let currentHolders = [];
	let moreResults = true;
	while (moreResults) {
		let url = `https://api.fluxbeam.xyz/v1/tokens/${tokenMint}/holders?page=${page}&limit=1000`;
		console.log(url);

		const resp = await axios.get(`https://api.fluxbeam.xyz/v1/tokens/${tokenMint}/holders?page=${page}&limit=1000`);
		// currentHolders = currentHolders.concat(resp.data);
		// moreResults = false;
		if (resp.data.length === 0) {
			moreResults = false;
		} else {
			currentHolders = currentHolders.concat(resp.data);
			page++;
		}
	}
	return currentHolders;
}

async function getTokenPoolAccounts() {
	const pools = await getSwapPools(tokenMint)

	const pMap = {}
	for (let i = 0; i < pools.length; i++) {
		pMap[pools[i].account.tokenAccountA.toString()] = true
		pMap[pools[i].account.tokenAccountB.toString()] = true
	}

	return pMap
}


async function getSwapPools(tokenA) {
	const SWAP_PROGRAM_ID = new anchor.web3.PublicKey("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X")
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")
	const resp = await connection.getProgramAccounts(SWAP_PROGRAM_ID, {
		commitment: 'confirmed',
		filters: [
			{
				memcmp: {
					offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
					bytes: tokenA.toString(),
				},
			},
		],
	})
	const respInverse = await connection.getProgramAccounts(SWAP_PROGRAM_ID, {
		commitment: 'confirmed',
		filters: [
			{
				memcmp: {
					offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
					bytes: tokenA.toString(),
				},
			},
		],
	})
	//@ts-ignore
	return resp.concat(respInverse).map((m) => {
		console.log("Pools", m.pubkey.toString())
		return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
	})
}

main();