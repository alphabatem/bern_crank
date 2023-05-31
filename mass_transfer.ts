import * as anchor from "@project-serum/anchor";
import {createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {AddressLookupTableAccount, AddressLookupTableProgram, Connection, sendAndConfirmTransaction} from "@solana/web3.js";
import axios from "axios";


describe("Mass transfer tokens", () => {
	const skipPreflight = true;

	//Set Token Mint
	let tokenMint = new anchor.web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");

	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")

	const owner = loadWalletKey("./TestBp2mbAfJC27E4N7TGKZwzoYxuLiEahYcsrXmPhQ.json")


	//Token mint info
	let mintInfo;

	//Token mint program
	let mintProgram: anchor.web3.PublicKey;

	//Current holders of the token mint
	let currentHolders;

	const lookupTablesToClose = [
		new anchor.web3.PublicKey("HakLcjCSzUpDqbpudhuzmsFVoxY2j9CKjvBfT26XuWM2"),
	];

	it("Transfers tokens using LUTs", async () => {

		await closeAllLookupTables()

		//Token mint info
		mintInfo = await connection.getParsedAccountInfo(tokenMint, "confirmed")
		mintProgram = new anchor.web3.PublicKey(mintInfo.value.owner)
		mintInfo = mintInfo.value.data.parsed.info

		//Token holders
		currentHolders = await getAllTokenHolders();
		console.log("Current Holders: ", currentHolders.length)


		await reflectToHolders(0)
	})


	async function reflectToHolders(amountPerToken) {
		const src = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
		const batchSize = 29; // size of each batch of instructions to fit into a txn

		for (let i = 0; i < currentHolders.length; i += batchSize) {
			const endIndex = Math.min(i + batchSize, currentHolders.length);
			await processBatch(i, endIndex, currentHolders, amountPerToken, src, tokenMint, owner, mintInfo, mintProgram);
		}

		console.log("Closing lookup tables...")
		await closeAllLookupTables()
	}

	async function processBatch(startIndex, endIndex, currentHolders, amountPerToken, src: anchor.web3.PublicKey, tokenMint: anchor.web3.PublicKey, owner: anchor.web3.Keypair, mintInfo, mintProgram: anchor.web3.PublicKey) {
		const ixs = [];
		let addrs = [tokenMint];

		for (let i = startIndex; i < endIndex; i++) {
			const holder = currentHolders[i];
			if (holder.amount <= 0)
				continue;

			const holderAddr = new anchor.web3.PublicKey(holder.address);

			//Add to our LUT
			addrs.push(holderAddr);

			const totalAmount = Math.floor(holder.amount * amountPerToken);

			//Add our transfer IX
			ixs.push(createTransferCheckedInstruction(src, tokenMint, holderAddr, owner.publicKey, totalAmount, mintInfo.decimals, [], mintProgram));
		}

		//Get blockhash for this batch
		const latestBlockHash = await connection.getLatestBlockhash();

		//Build our LUT
		const [createIx, lut] = await createAddressTableInstruction()

		const extendIx = await extendAddressTableInstruction(lut, addrs)
		console.log("Extending address table", addrs.length)


		const lutMsg = new anchor.web3.TransactionMessage({
			payerKey: owner.publicKey,
			recentBlockhash: latestBlockHash.blockhash,
			instructions: [createIx, extendIx]
		}).compileToV0Message()
		const lutTx = new anchor.web3.VersionedTransaction(lutMsg)
		lutTx.sign([owner])


		console.log("Sending LUT")
		let sig = await connection.sendTransaction(lutTx, {
			skipPreflight: skipPreflight,
			preflightCommitment: "confirmed"
		})

		console.log("Confirming LUT")
		await connection.confirmTransaction({
			signature: sig,
			blockhash: lutTx.message.recentBlockhash,
			lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
		})
		console.log("LUT Sig:", sig)

		await new Promise(r => setTimeout(r, 400));


		//Create our LUT for the accounts
		const lookupTableAccount = new AddressLookupTableAccount({
			key: lut,
			state: {
				deactivationSlot: BigInt(0),
				lastExtendedSlot: 0,
				lastExtendedSlotStartIndex: 0,
				authority: owner.publicKey,
				addresses: addrs
			}
		})

		//Close the table once we are done
		ixs.push(AddressLookupTableProgram.deactivateLookupTable({
			authority: owner.publicKey,
			lookupTable: lut,
		}))

		//Schedule the lut for removal once done
		lookupTablesToClose.push(lut)

		const msg = new anchor.web3.TransactionMessage({
			payerKey: owner.publicKey,
			recentBlockhash: latestBlockHash.blockhash,
			instructions: ixs
		}).compileToV0Message([lookupTableAccount])

		let txn = new anchor.web3.VersionedTransaction(msg);
		txn.sign([owner])

		sig = await connection.sendTransaction(txn, {
			skipPreflight: skipPreflight,
			preflightCommitment: "confirmed"
		})

		await connection.confirmTransaction({
			signature: sig,
			blockhash: txn.message.recentBlockhash,
			lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
		})
		console.log("REFLECT Sig: ", sig);
	}


	//Get token holders from fluxbeam
	async function getAllTokenHolders() {
		let page = 0;
		let currentHolders = [];
		let moreResults = true;
		while (moreResults) {
			const resp = await axios.get(`https://api.fluxbeam.xyz/v1/tokens/${tokenMint}/holders?page=${page}&limit=300`);
			if (resp.data.length === 0) {
				moreResults = false;
			} else {
				currentHolders = currentHolders.concat(resp.data);
				page++;
			}
		}
		return currentHolders;
	}

	async function closeAllLookupTables() {

		const tables = await connection.getProgramAccounts(new anchor.web3.PublicKey("AddressLookupTab1e1111111111111111111111111"), {
			commitment: "confirmed",
			filters: [
				{
					memcmp: {
						offset: 22, //4 + 8 + 8 + 1 + 1
						bytes: owner.publicKey.toString(),
					}
				}
			]
		})

		console.log("Tables", tables.length)


		let txn = new anchor.web3.Transaction()
		for (let i = 0; i < tables.length; i++) {
			txn.add(closeAddressTableInstruction(tables[i].pubkey))

			if (txn.instructions.length > 18) {
				const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
				console.log("CLOSE LUT Sig: ", sig)

				//Reset txn for next round
				txn = new anchor.web3.Transaction()
			}
		}

		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight})
		console.log("CLOSE LUT Sig: ", sig)
	}

	//Create a new LUT
	async function createAddressTableInstruction(recentSlot = 0) {
		if (recentSlot === 0) {
			recentSlot = await connection.getSlot("confirmed")
		}

		return AddressLookupTableProgram.createLookupTable({
			authority: owner.publicKey,
			payer: owner.publicKey,
			recentSlot: recentSlot
		})
	}

	//Extend a new LUT
	async function extendAddressTableInstruction(table: anchor.web3.PublicKey, addresses: anchor.web3.PublicKey[]) {
		return AddressLookupTableProgram.extendLookupTable({
			lookupTable: table,
			authority: owner.publicKey,
			payer: owner.publicKey,
			addresses: addresses,
		})
	}


	//Dispose of a LUT
	function closeAddressTableInstruction(table: anchor.web3.PublicKey) {
		return AddressLookupTableProgram.closeLookupTable({
			authority: owner.publicKey,
			lookupTable: table,
			recipient: owner.publicKey
		})
	}


	function loadWalletKey(keypairFile: string): anchor.web3.Keypair {
		if (!keypairFile || keypairFile == '') {
			throw new Error('Keypair is required!');
		}
		const fs = require("fs");
		const loaded = anchor.web3.Keypair.fromSecretKey(
			new Uint8Array(JSON.parse(fs.readFileSync(keypairFile).toString())),
		);
		return loaded;
	}
})