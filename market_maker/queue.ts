import {web3} from "@project-serum/anchor";

export class QueuedTransaction {
	transaction: web3.Transaction
	attempts: 0

	constructor(txn: web3.Transaction) {
		this.transaction = txn
	}
}

export class Queue {
	executionQueue: QueuedTransaction[] = []

	failedQueue: QueuedTransaction[] = []

	/**
	 * Add a new transaction to the queue
	 * @param txn
	 */
	push(txn: web3.Transaction) {
		this.executionQueue.push(new QueuedTransaction(txn))
	}

	/**
	 * Process a single txn in the execution queue
	 * @param connection
	 * @param owner
	 */
	process(connection: web3.Connection, owner: web3.Keypair) {
		const qtx = this.executionQueue.pop()

		const sig = connection.sendTransaction(qtx.transaction, [owner])
		if (!sig) {
			console.log(`TXN FAILED ${qtx.attempts}`)
			qtx.attempts++

			if (qtx.attempts < 3)
				this.executionQueue.push(qtx) //Retry at end
		}
	}

	/**
	 * Prints all failed txns
	 */
	printFailed() {
		for (let i = 0; i < this.failedQueue.length; i++) {
			const ftx = this.failedQueue.pop()
			console.log(`${i} Failed`, ftx.transaction) //TODO string representation?
		}
	}
}