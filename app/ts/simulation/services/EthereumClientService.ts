import { EthereumUnsignedTransaction, EthereumSignedTransactionWithBlockData, EthereumQuantity, EthereumBlockTag, EthereumData, EthereumBlockHeader, EthereumBlockHeaderWithTransactionHashes, EthereumBytes32 } from '../../types/wire-types.js'
import { IUnsignedTransaction1559 } from '../../utils/ethereum.js'
import { TIME_BETWEEN_BLOCKS, MOCK_ADDRESS } from '../../utils/constants.js'
import { IEthereumJSONRpcRequestHandler } from './EthereumJSONRpcRequestHandler.js'
import { AbiCoder, Signature, ethers } from 'ethers'
import { addressString, bytes32String } from '../../utils/bigint.js'
import { BlockCalls, ExecutionSpec383MultiCallBlockResult, ExecutionSpec383MultiCallResult } from '../../types/multicall-types.js'
import { MulticallResponse, EthGetStorageAtResponse, EthTransactionReceiptResponse, EthGetLogsRequest, EthGetLogsResponse, DappRequestTransaction } from '../../types/JsonRpc-types.js'
import { assertNever } from '../../utils/typescript.js'
import { MessageHashAndSignature, SignatureWithFakeSignerAddress, simulatePersonalSign } from './SimulationModeEthereumClientService.js'
import { getEcRecoverOverride } from '../../utils/ethereumByteCodes.js'
import * as funtypes from 'funtypes'

export type IEthereumClientService = Pick<EthereumClientService, keyof EthereumClientService>
export class EthereumClientService {
	private cachedBlock: EthereumBlockHeader | undefined = undefined
	private cacheRefreshTimer: NodeJS.Timer | undefined = undefined
	private lastCacheAccess: number = 0
	private retrievingBlock: boolean = false
	private newBlockAttemptCallback: (blockHeader: EthereumBlockHeader, ethereumClientService: EthereumClientService, isNewBlock: boolean) => Promise<void>
	private onErrorBlockCallback: (ethereumClientService: EthereumClientService) => Promise<void>
	private requestHandler
	private cleanedUp = false

    constructor(requestHandler: IEthereumJSONRpcRequestHandler, newBlockAttemptCallback: (blockHeader: EthereumBlockHeader, ethereumClientService: EthereumClientService, isNewBlock: boolean) => Promise<void>, onErrorBlockCallback: (ethereumClientService: EthereumClientService) => Promise<void>) {
		this.requestHandler = requestHandler
		this.newBlockAttemptCallback = newBlockAttemptCallback
		this.onErrorBlockCallback = onErrorBlockCallback
    }

	public readonly getRpcEntry = () => this.requestHandler.getRpcEntry()
	
	public readonly getNewBlockAttemptCallback = () => this.newBlockAttemptCallback
	public readonly getOnErrorBlockCallback = () => this.onErrorBlockCallback

	public getLastKnownCachedBlockOrUndefined = () => this.cachedBlock

	public getCachedBlock() {
		if (this.cleanedUp === false) {
			this.setBlockPolling(true)
		}
		this.lastCacheAccess = Date.now()
		return this.cachedBlock
	}

	public cleanup = () => {
		this.cleanedUp = true
		this.setBlockPolling(false)
	}

	public readonly setBlockPolling = (enabled: boolean) => {
		if (enabled && this.cacheRefreshTimer === undefined) {
			const now = Date.now()

			// query block everytime clock hits time % 12 + 7
			this.updateCache()
			const timeToTarget = Math.floor(now / 1000 / TIME_BETWEEN_BLOCKS) * 1000 * TIME_BETWEEN_BLOCKS + 7 * 1000 - now
			this.cacheRefreshTimer = setTimeout( () => { // wait until the clock is just right ( % 12 + 7 ), an then start querying every TIME_BETWEEN_BLOCKS secs
				this.updateCache()
				this.cacheRefreshTimer = setInterval(this.updateCache, TIME_BETWEEN_BLOCKS * 1000)
				if (this.lastCacheAccess - Date.now() > 180000) {
					this.setBlockPolling(false)
				}
			}, timeToTarget > 0 ? timeToTarget : timeToTarget + TIME_BETWEEN_BLOCKS * 1000 )
			return
		}
		if (!enabled) {
			clearTimeout(this.cacheRefreshTimer)
			clearInterval(this.cacheRefreshTimer)
			this.cacheRefreshTimer = undefined
			this.cachedBlock = undefined
			return
		}
	}

	private readonly updateCache = async () => {
		if (this.retrievingBlock) return
		try {
			this.retrievingBlock = true
			const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getBlockByNumber', params: ['latest', true] }, true, 6000)
			if (this.cacheRefreshTimer === undefined) return
			const newBlock = EthereumBlockHeader.parse(response)
			console.log(`Current block number: ${ newBlock.number }`)
			const gotNewBlock = this.cachedBlock?.number !== newBlock.number
			if (gotNewBlock) this.requestHandler.clearCache()
			this.newBlockAttemptCallback(newBlock, this, gotNewBlock)
			this.cachedBlock = newBlock
		} catch(error) {
			console.log(`Failed to get a block`)
			console.warn(error)
			return this.onErrorBlockCallback(this)
		} finally {
			this.retrievingBlock = false
		}
	}

	public readonly estimateGas = async (data: DappRequestTransaction) => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_estimateGas', params: [data] } )
		return EthereumQuantity.parse(response)
	}

	public readonly getStorageAt = async (contract: bigint, slot: bigint, blockTag: EthereumBlockTag = 'latest') => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getStorageAt', params: [contract, slot, blockTag] })
		return EthGetStorageAtResponse.parse(response)
	}

	public readonly getTransactionCount = async (address: bigint, blockTag: EthereumBlockTag = 'latest') => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getTransactionCount', params: [address, blockTag] })
		return EthereumQuantity.parse(response)
	}

	public readonly getTransactionReceipt = async (hash: bigint) => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getTransactionReceipt', params: [hash] })
		return EthTransactionReceiptResponse.parse(response)
	}

	public readonly getBalance = async (address: bigint, blockTag: EthereumBlockTag = 'latest') => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getBalance', params: [address, blockTag] })
		return EthereumQuantity.parse(response)
	}

	public readonly getCode = async (address: bigint, blockTag: EthereumBlockTag = 'latest') => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getCode', params: [address, blockTag] })
		return EthereumData.parse(response)
	}

	public async getBlock(blockTag?: EthereumBlockTag, fullObjects?: true): Promise<EthereumBlockHeader>
	public async getBlock(blockTag: EthereumBlockTag, fullObjects: boolean): Promise<EthereumBlockHeaderWithTransactionHashes | EthereumBlockHeader>
	public async getBlock(blockTag: EthereumBlockTag, fullObjects: false): Promise<EthereumBlockHeaderWithTransactionHashes>
	public async getBlock(blockTag: EthereumBlockTag = 'latest', fullObjects: boolean = true): Promise<EthereumBlockHeaderWithTransactionHashes | EthereumBlockHeader> {
		const cached = this.getCachedBlock()
		if (cached && (blockTag === 'latest' || blockTag === cached.number)) {
			if (fullObjects === false) {
				return { ...cached, transactions: cached.transactions.map((transaction) => transaction.hash) }
			}
			return cached
		}
		if (fullObjects === false) {
			return EthereumBlockHeaderWithTransactionHashes.parse(await this.requestHandler.jsonRpcRequest({ method: 'eth_getBlockByNumber', params: [blockTag, false] }))
		}
		return EthereumBlockHeader.parse(await this.requestHandler.jsonRpcRequest({ method: 'eth_getBlockByNumber', params: [blockTag, fullObjects] }))
	}

	public async getBlockByHash(blockHash: EthereumBytes32, fullObjects: boolean = true): Promise<EthereumBlockHeaderWithTransactionHashes | EthereumBlockHeader> {
		const cached = this.getCachedBlock()
		if (cached && (cached.hash === blockHash)) {
			if (fullObjects === false) {
				return { ...cached, transactions: cached.transactions.map((transaction) => transaction.hash) }
			}
			return cached
		}
		if (fullObjects === false) {
			return EthereumBlockHeaderWithTransactionHashes.parse(await this.requestHandler.jsonRpcRequest({ method: 'eth_getBlockByHash', params: [blockHash, false] }))
		}
		return EthereumBlockHeader.parse(await this.requestHandler.jsonRpcRequest({ method: 'eth_getBlockByHash', params: [blockHash, fullObjects] }))
	}

	public readonly getChainId = () => this.requestHandler.getRpcEntry().chainId

	public readonly getLogs = async (logFilter: EthGetLogsRequest) => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getLogs', params: [logFilter] })
		return EthGetLogsResponse.parse(response)
	}

	public readonly getBlockNumber = async () => {
		const cached = this.getCachedBlock()
		if (cached) return cached.number
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_blockNumber' })
		return EthereumQuantity.parse(response)
	}

	public readonly getGasPrice = async() => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_gasPrice' })
		return EthereumQuantity.parse(response)
	}

	public readonly getTransactionByHash = async (hash: bigint) => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_getTransactionByHash', params: [hash] })
		if( response === null) return undefined
		return EthereumSignedTransactionWithBlockData.parse(response)
	}

	public readonly call = async (transaction: Partial<Pick<IUnsignedTransaction1559, 'to' | 'from' | 'input' | 'value' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasLimit'>>, blockTag: EthereumBlockTag = 'latest') => {
		if (transaction.to === null) throw new Error('To cannot be null')
		const params = {
			to: transaction.to,
			from: transaction.from,
			data: transaction.input,
			value: transaction.value,
			...transaction.maxFeePerGas !== undefined && transaction.maxPriorityFeePerGas !== undefined ? { gasPrice: transaction.maxFeePerGas + transaction.maxPriorityFeePerGas } : {},
			gas: transaction.gasLimit
		}
		const response = await this.requestHandler.jsonRpcRequest({ method: 'eth_call', params: [params, blockTag] })
		return response as string
	}

	public readonly multicall = async (transactions: readonly EthereumUnsignedTransaction[], spoofedSignatures: readonly SignatureWithFakeSignerAddress[], blockNumber: bigint) => {
		const httpsRpc = this.requestHandler.getRpcEntry().httpsRpc
		if (httpsRpc === 'https://rpc.dark.florist/winedancemuffinborrow' || httpsRpc === 'https://rpc.dark.florist/birdchalkrenewtip') {
			//TODO: Remove this when we get rid of our old multicall
			return this.executionSpec383MultiCallOnlyTransactionsAndSignatures(transactions, spoofedSignatures, blockNumber)
		}

		const blockAuthor: bigint = MOCK_ADDRESS
		const unvalidatedResult = await this.requestHandler.jsonRpcRequest({ method: 'eth_multicall', params: [blockNumber, blockAuthor, transactions] })
		return MulticallResponse.parse(unvalidatedResult)
	}

	public readonly executionSpec383MultiCall = async (blockStateCalls: readonly BlockCalls[], blockTag: EthereumBlockTag) => {
		const parentBlock = await this.getBlock()
		const call = {
			method: 'eth_multicallV1',
			params: [{
				blockStateCalls: blockStateCalls,
				traceTransfers: true,
				validation: false,
			},
			blockTag === parentBlock.number + 1n ? blockTag - 1n : blockTag
		] } as const
		const unvalidatedResult = await this.requestHandler.jsonRpcRequest(call)
		/*
		console.log('executionSpec383MultiCall')
		console.log(call)
		console.log(unvalidatedResult)
		console.log(stringifyJSONWithBigInts(ExecutionSpec383MultiCallParams.serialize(call)))
		console.log(stringifyJSONWithBigInts(unvalidatedResult))
		console.log('end')
		*/
		return ExecutionSpec383MultiCallResult.parse(unvalidatedResult)
	}

	public convertExecutionSpec383MulticallToOldMulticall(singleResult: ExecutionSpec383MultiCallBlockResult) {
		return singleResult.calls.map((singleResult) => {
			switch (singleResult.status) {
				case 'success': {
					return {
						statusCode: 'success' as const,
						gasSpent: singleResult.gasUsed,
						returnValue: singleResult.returnData,
						events: (singleResult.logs === undefined ? [] : singleResult.logs).map((log) => ({
							loggersAddress: log.address,
							data: 'data' in log && log.data !== undefined ? log.data : new Uint8Array(),
							topics: 'topics' in log && log.topics !== undefined ? log.topics : [],
						})),
						balanceChanges: [],
					}
				}
				case 'failure': return {
					statusCode: 'failure' as const,
					gasSpent: singleResult.gasUsed,
					error: singleResult.error.message,
					returnValue: singleResult.returnData,
				}
				case 'invalid': return {
					statusCode: 'failure' as const,
					gasSpent: 0n,
					error: singleResult.error.message,
					returnValue: new Uint8Array(),
				}
				default: assertNever(singleResult)
			}
		})
	}

	// intended drop in replacement of the old multicall
	public readonly executionSpec383MultiCallOnlyTransactionsAndSignatures = async (transactions: readonly EthereumUnsignedTransaction[], signatures: readonly SignatureWithFakeSignerAddress[], blockNumber: bigint): Promise<MulticallResponse> => {
		const ecRecoverMovedToAddress = 0x123456n
		const ecRecoverAddress = 1n
		const parentBlock = await this.getBlock()
		const coder = AbiCoder.defaultAbiCoder()

		const encodePackedHash = (messageHashAndSignature: MessageHashAndSignature) => {
			const sig = Signature.from(messageHashAndSignature.signature)
			const packed = BigInt(ethers.keccak256(coder.encode(['bytes32', 'uint8', 'bytes32', 'bytes32'], [messageHashAndSignature.messageHash, sig.v, sig.r, sig.s])))
			return packed
		}
		
		// set mapping storage mapping() (instructed here: https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)
		const getMappingsMemorySlot = (hash: EthereumBytes32) => ethers.keccak256(coder.encode(['bytes32', 'uint256'], [bytes32String(hash), 0n]))
		const signatureStructs = await Promise.all(signatures.map(async (sign) => ({ key: getMappingsMemorySlot(encodePackedHash(await simulatePersonalSign(sign.originalRequestParameters, sign.fakeSignedFor))), value: sign.fakeSignedFor })))
		const stateSets = signatureStructs.reduce((acc, current) => {
			acc[current.key] = current.value
			return acc
		}, {} as { [key: string]: bigint } )

		const query = [{
			calls: transactions,
			blockOverride: {
				number: blockNumber + 1n,
				prevRandao: 0x1n,
				time: new Date(parentBlock.timestamp.getTime() + 12 * 1000),
				gasLimit: parentBlock.gasLimit,
				feeRecipient: parentBlock.miner,
				baseFee: parentBlock.baseFeePerGas === undefined ? 15000000n : parentBlock.baseFeePerGas
			},
			...signatures.length > 0 ? {
				stateOverrides: { [addressString(ecRecoverAddress)]: {
					movePrecompileToAddress: ecRecoverMovedToAddress,
					code: getEcRecoverOverride(),
					state: stateSets,
				} },
			} : {},
		}]
		const multicallResults = await this.executionSpec383MultiCall(query, blockNumber)
		if (multicallResults.length !== 1) throw new Error('Multicalled for one block but did not get one block')
		const singleMulticalResult = multicallResults[0]
		if (singleMulticalResult === undefined) throw new Error('multicallResult was undefined')
		return this.convertExecutionSpec383MulticallToOldMulticall(singleMulticalResult)
	}

	public readonly web3ClientVersion = async () => {
		const response = await this.requestHandler.jsonRpcRequest({ method: 'web3_clientVersion', params: [] } )
		return funtypes.String.parse(response)
	}
}
