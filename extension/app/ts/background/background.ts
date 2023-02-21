import { HandleSimulationModeReturnValue, InterceptedRequest, InterceptedRequestForward, PopupMessage, ProviderMessage, SignerName } from '../utils/interceptor-messages.js'
import 'webextension-polyfill'
import { Simulator } from '../simulation/simulator.js'
import { EthereumJsonRpcRequest, EthereumQuantity, EthereumUnsignedTransaction, PersonalSignParams, SignTypedDataParams } from '../utils/wire-types.js'
import { getSettings, saveActiveChain, saveActiveSigningAddress, saveActiveSimulationAddress, Settings } from './settings.js'
import { blockNumber, call, chainId, estimateGas, gasPrice, getAccounts, getBalance, getBlockByNumber, getCode, getPermissions, getSimulationStack, getTransactionByHash, getTransactionCount, getTransactionReceipt, personalSign, requestPermissions, sendTransaction, signTypedData, subscribe, switchEthereumChain, unsubscribe } from './simulationModeHanders.js'
import { changeActiveAddress, changeMakeMeRich, changePage, resetSimulation, confirmDialog, refreshSimulation, removeTransaction, requestAccountsFromSigner, refreshPopupConfirmTransactionSimulation, confirmPersonalSign, confirmRequestAccess, changeInterceptorAccess, changeChainDialog, popupChangeActiveChain, enableSimulationMode, reviewNotification, rejectNotification, addOrModifyAddressInfo, getAddressBookData, removeAddressBookEntry, openAddressBook } from './popupMessageHandlers.js'
import { SimResults, SimulationState, TokenPriceEstimate } from '../utils/visualizer-types.js'
import { WebsiteApproval, SignerState, TabConnection, AddressBookEntry, AddressInfoEntry } from '../utils/user-interface-types.js'
import { getAddressMetadataForAccess, setPendingAccessRequests } from './windows/interceptorAccess.js'
import { CHAINS, ICON_NOT_ACTIVE, isSupportedChain, MAKE_YOU_RICH_TRANSACTION, METAMASK_ERROR_USER_REJECTED_REQUEST } from '../utils/constants.js'
import { PriceEstimator } from '../simulation/priceEstimator.js'
import { getActiveAddressForDomain, sendActiveAccountChangeToApprovedWebsitePorts, sendMessageToApprovedWebsitePorts, updateWebsiteApprovalAccesses, verifyAccess } from './accessManagement.js'
import { getAddressBookEntriesForVisualiser } from './metadataUtils.js'
import { getActiveAddress, sendPopupMessageToOpenWindows } from './backgroundUtils.js'
import { updateExtensionIcon } from './iconHandler.js'
import { connectedToSigner, ethAccountsReply, signerChainChanged, walletSwitchEthereumChainReply } from './providerMessageHandlers.js'
import { SimulationModeEthereumClientService } from '../simulation/services/SimulationModeEthereumClientService.js'
import { assertUnreachable } from '../utils/typescript.js'

browser.runtime.onConnect.addListener(port => onContentScriptConnected(port).catch(console.error))

export enum PrependTransactionMode {
	NO_PREPEND,
	RICH_MODE
}

let currentPrependMode: PrependTransactionMode = PrependTransactionMode.NO_PREPEND
let simulator: Simulator | undefined = undefined

declare global {
	interface Window {
		interceptor: {
			simulation: {
				simulationId: number,
				simulationState: SimulationState | undefined,
				visualizerResults: SimResults[] | undefined,
				addressBookEntries: AddressBookEntry[],
				tokenPrices: TokenPriceEstimate[],
			}
			websiteAccessAddressMetadata: AddressInfoEntry[],
			pendingAccessMetadata: [string, AddressInfoEntry][],
			prependTransactionMode: PrependTransactionMode,
			signerAccounts: readonly bigint[] | undefined,
			signerChain: bigint | undefined,
			signerName: SignerName | undefined,
			websiteTabSignerStates: Map<number, SignerState>,
			websitePortApprovals: Map<browser.runtime.Port, WebsiteApproval>, // map of ports that are either approved or not-approved by interceptor
			websiteTabApprovals: Map<number, WebsiteApproval>,
			websiteTabConnection: Map<number, TabConnection>,
			settings: Settings | undefined,
			currentBlockNumber: bigint | undefined,
		}
	}
}

window.interceptor = {
	prependTransactionMode: PrependTransactionMode.NO_PREPEND,
	websiteAccessAddressMetadata: [],
	pendingAccessMetadata: [],
	signerAccounts: undefined,
	signerChain: undefined,
	signerName: undefined,
	websiteTabSignerStates: new Map(),
	settings: undefined,
	websitePortApprovals: new Map(),
	websiteTabApprovals: new Map(),
	websiteTabConnection: new Map(),
	simulation: {
		simulationId: 0,
		simulationState: undefined,
		visualizerResults: undefined,
		addressBookEntries: [],
		tokenPrices: [],
	},
	currentBlockNumber: undefined,
}

export async function updateSimulationState( getUpdatedSimulationState: () => Promise<SimulationState | undefined>) {
	try {
		window.interceptor.simulation.simulationId++

		if ( simulator === undefined ) {
			window.interceptor.simulation = {
				simulationId: window.interceptor.simulation.simulationId,
				simulationState: undefined,
				addressBookEntries: [],
				tokenPrices: [],
				visualizerResults: [],
			}
			sendPopupMessageToOpenWindows({ method: 'popup_simulation_state_changed' })
			return
		}

		const updatedSimulationState = await getUpdatedSimulationState()

		const simId = window.interceptor.simulation.simulationId
		if ( updatedSimulationState !== undefined ) {
			const priceEstimator = new PriceEstimator(simulator.ethereum)

			const transactions = updatedSimulationState.simulatedTransactions.map(x => x.signedTransaction)
			const visualizerResult = await simulator.visualizeTransactionChain(transactions, updatedSimulationState.blockNumber, updatedSimulationState.simulatedTransactions.map( x => x.multicallResponse))
			const addressBookEntries = await getAddressBookEntriesForVisualiser(simulator, visualizerResult.map( (x) => x.visualizerResults), updatedSimulationState, window.interceptor.settings?.userAddressBook)

			function onlyTokensAndTokensWithKnownDecimals(metadata: AddressBookEntry) : metadata is AddressBookEntry & { type: 'token', decimals: `0x${ string }` } {
				if (metadata.type !== 'token') return false
				if (metadata.decimals === undefined) return false
				return true
			}
			function metadataRestructure(metadata: AddressBookEntry &  { type: 'token', decimals: bigint } ) {
				return { token: metadata.address, decimals: metadata.decimals }
			}
			const tokenPrices = await priceEstimator.estimateEthereumPricesForTokens(addressBookEntries.filter(onlyTokensAndTokensWithKnownDecimals).map(metadataRestructure))

			if (simId !== window.interceptor.simulation.simulationId) return // do not update state if we are already calculating a new one

			window.interceptor.simulation = {
				simulationId: window.interceptor.simulation.simulationId,
				tokenPrices: tokenPrices,
				addressBookEntries: addressBookEntries,
				visualizerResults: visualizerResult,
				simulationState: updatedSimulationState,
			}
		} else {
			window.interceptor.simulation = {
				simulationId: window.interceptor.simulation.simulationId,
				addressBookEntries: [],
				tokenPrices: [],
				visualizerResults: [],
				simulationState: updatedSimulationState,
			}
		}
		sendPopupMessageToOpenWindows({ method: 'popup_simulation_state_changed' })
		return updatedSimulationState
	} catch(e) {
		throw e
	}
}

export function setEthereumNodeBlockPolling(enabled: boolean) {
	if (simulator === undefined) return
	simulator.ethereum.setBlockPolling(enabled)
}

export async function refreshConfirmTransactionSimulation(activeAddress: bigint, simulationMode: boolean, requestId: number, transactionToSimulate: EthereumUnsignedTransaction, websiteOrigin: string, websiteIcon: string | undefined) {
	if ( simulator === undefined ) return undefined

	const priceEstimator = new PriceEstimator(simulator.ethereum)
	const newSimulator = simulator.simulationModeNode.copy()
	sendPopupMessageToOpenWindows({ method: 'popup_confirm_transaction_simulation_started' })
	const appended = await newSimulator.appendTransaction(transactionToSimulate)
	const transactions = appended.simulationState.simulatedTransactions.map(x => x.signedTransaction)
	const visualizerResult = await simulator.visualizeTransactionChain(transactions, appended.simulationState.blockNumber, appended.simulationState.simulatedTransactions.map( x => x.multicallResponse))
	const addressMetadata = await getAddressBookEntriesForVisualiser(simulator, visualizerResult.map( (x) => x.visualizerResults), appended.simulationState, window.interceptor.settings?.userAddressBook)
	const tokenPrices = await priceEstimator.estimateEthereumPricesForTokens(
		addressMetadata.map(
			(x) => x.type === 'token' && x.decimals !== undefined ? { token: x.address, decimals: x.decimals } : { token: 0x0n, decimals: 0x0n }
		).filter( (x) => x.token !== 0x0n )
	)

	return {
		method: 'popup_confirm_transaction_simulation_state_changed' as const,
		data: {
			requestId: requestId,
			transactionToSimulate: transactionToSimulate,
			simulationMode: simulationMode,
			simulationState: appended.simulationState,
			visualizerResults: visualizerResult,
			addressBookEntries: addressMetadata,
			tokenPrices: tokenPrices,
			activeAddress: activeAddress,
			signerName: window.interceptor.signerName,
			websiteOrigin,
			websiteIcon,
		}
	}
}


// returns true if simulation state was changed
export async function updatePrependMode(forceRefresh: boolean = false) {
	if ( currentPrependMode === window.interceptor.prependTransactionMode && !forceRefresh ) return
	if ( simulator === undefined ) return
	if ( window.interceptor.settings === undefined ) return
	if ( !window.interceptor.settings.simulationMode ) {
		await updateSimulationState(async () => await simulator?.simulationModeNode.setPrependTransactionsQueue([]))
		currentPrependMode = window.interceptor.prependTransactionMode
		return true
	}

	switch(window.interceptor.prependTransactionMode) {
		case PrependTransactionMode.NO_PREPEND: {
			await updateSimulationState(async () => await simulator?.simulationModeNode.setPrependTransactionsQueue([]))
			break
		}
		case PrependTransactionMode.RICH_MODE: {
			const activeAddress = getActiveAddress()
			const chainId = window.interceptor.settings.activeChain.toString()
			if ( !isSupportedChain(chainId) ) return false
			if ( activeAddress === undefined ) return false
			await updateSimulationState(async () => {
				if ( window.interceptor.settings === undefined ) return undefined
				if ( simulator === undefined ) return undefined
				if ( !isSupportedChain(chainId) ) return undefined
				const queue = [{
					from: CHAINS[chainId].eth_donator,
					chainId: CHAINS[chainId].chainId,
					nonce: await simulator.ethereum.getTransactionCount(CHAINS[chainId].eth_donator),
					to: activeAddress,
					...MAKE_YOU_RICH_TRANSACTION
				} as const]
				return await simulator.simulationModeNode.setPrependTransactionsQueue(queue)
			})
			break
		}
	}
	currentPrependMode = window.interceptor.prependTransactionMode
	return true
}

export async function appendTransactionToSimulator(transaction: EthereumUnsignedTransaction) {
	if ( simulator === undefined) return
	const simulationState = await updateSimulationState(async () => (await simulator?.simulationModeNode.appendTransaction(transaction))?.simulationState)
	return {
		signed: await SimulationModeEthereumClientService.mockSignTransaction(transaction),
		simulationState: simulationState,
	}
}

export async function personalSignWithSimulator(params: PersonalSignParams | SignTypedDataParams) {
	if ( simulator === undefined) return
	return await simulator.simulationModeNode.personalSign(params)
}

async function handleSimulationMode(simulator: Simulator, port: browser.runtime.Port, request: InterceptedRequest): Promise<HandleSimulationModeReturnValue> {
	let parsedRequest // separate request parsing and request handling. If there's a parse error, throw that to API user
	try {
		parsedRequest = EthereumJsonRpcRequest.parse(request.options)
	} catch (error) {
		if (error instanceof Error) {
			return {
				error: {
					message: error.message,
					code: 400,
				}
			}
		}
		throw error
	}

	await updatePrependMode()

	switch (parsedRequest.method) {
		case 'eth_getBlockByNumber': return await getBlockByNumber(simulator, parsedRequest)
		case 'eth_getBalance': return await getBalance(simulator, parsedRequest)
		case 'eth_estimateGas': return await estimateGas(simulator, parsedRequest)
		case 'eth_getTransactionByHash': return await getTransactionByHash(simulator, parsedRequest)
		case 'eth_getTransactionReceipt': return await getTransactionReceipt(simulator, parsedRequest)
		case 'eth_sendTransaction': return await sendTransaction(getActiveAddressForDomain, simulator, parsedRequest, port, request?.requestId)
		case 'eth_call': return await call(simulator, parsedRequest)
		case 'eth_blockNumber': return await blockNumber(simulator)
		case 'eth_subscribe': return await subscribe(simulator, port, parsedRequest)
		case 'eth_unsubscribe': return await unsubscribe(simulator, parsedRequest)
		case 'eth_chainId': return await chainId(simulator)
		case 'net_version': return await chainId(simulator)
		case 'eth_getCode': return await getCode(simulator, parsedRequest)
		case 'personal_sign': return await personalSign(simulator, parsedRequest, request?.requestId, true)
		case 'eth_signTypedData': return await signTypedData(simulator, parsedRequest, request?.requestId, true)
		case 'eth_signTypedData_v1': return await signTypedData(simulator, parsedRequest, request?.requestId, true)
		case 'eth_signTypedData_v2': return await signTypedData(simulator, parsedRequest, request?.requestId, true)
		case 'eth_signTypedData_v3': return await signTypedData(simulator, parsedRequest, request?.requestId, true)
		case 'eth_signTypedData_v4': return await signTypedData(simulator, parsedRequest, request?.requestId, true)
		case 'wallet_switchEthereumChain': return await switchEthereumChain(simulator, parsedRequest, port, request?.requestId, true)
		case 'wallet_requestPermissions': return await requestPermissions(getActiveAddressForDomain, simulator, port)
		case 'wallet_getPermissions': return await getPermissions()
		case 'eth_accounts': return await getAccounts(getActiveAddressForDomain, simulator, port)
		case 'eth_requestAccounts': return await getAccounts(getActiveAddressForDomain, simulator, port)
		case 'eth_gasPrice': return await gasPrice(simulator)
		case 'eth_getTransactionCount': return await getTransactionCount(simulator, parsedRequest)
		case 'interceptor_getSimulationStack': return await getSimulationStack(simulator, parsedRequest)
		case 'eth_multicall': return { error: { code: 10000, message: 'Cannot call eth_multicall directly' } }
		case 'eth_getStorageAt': return { error: { code: 10000, message: 'eth_getStorageAt not implemented' } }
		case 'eth_getLogs': return { error: { code: 10000, message: 'eth_getLogs not implemented' } }
		/*
		Missing methods:
		case 'eth_sendRawTransaction': return
		case 'eth_getProof': return
		case 'eth_getBlockTransactionCountByNumber': return
		case 'eth_getTransactionByBlockHashAndIndex': return
		case 'eth_getTransactionByBlockNumberAndIndex': return
		case 'eth_getBlockReceipts': return
		case 'eth_getStorageAt': return

		case 'eth_getLogs': return
		case 'eth_getFilterChanges': return
		case 'eth_getFilterLogs': return
		case 'eth_newBlockFilter': return
		case 'eth_newFilter': return
		case 'eth_newPendingTransactionFilter': return
		case 'eth_uninstallFilter': return

		case 'eth_protocolVersion': return
		case 'eth_feeHistory': return
		case 'eth_maxPriorityFeePerGas': return
		case 'net_listening': return

		case 'eth_getUncleByBlockHashAndIndex': return
		case 'eth_getUncleByBlockNumberAndIndex': return
		case 'eth_getUncleCountByBlockHash': return
		case 'eth_getUncleCountByBlockNumber': return
		*/
	}
}

async function handleSigningMode(simulator: Simulator, port: browser.runtime.Port, request: InterceptedRequest): Promise<HandleSimulationModeReturnValue> {
	let parsedRequest // separate request parsing and request handling. If there's a parse error, throw that to API user
	try {
		parsedRequest = EthereumJsonRpcRequest.parse(request.options)
	} catch (error) {
		if (error instanceof Error) {
			return {
				error: {
					message: error.message,
					code: 400,
				}
			}
		}
		throw error
	}

	const forwardToSigner = () => ({ forward: true } as const)

	switch (parsedRequest.method) {
		case 'eth_getBlockByNumber':
		case 'eth_getBalance':
		case 'eth_estimateGas':
		case 'eth_getTransactionByHash':
		case 'eth_getTransactionReceipt':
		case 'eth_call':
		case 'eth_blockNumber':
		case 'eth_subscribe':
		case 'eth_unsubscribe':
		case 'eth_chainId':
		case 'net_version':
		case 'eth_getCode':
		case 'wallet_requestPermissions':
		case 'wallet_getPermissions':
		case 'eth_accounts':
		case 'eth_requestAccounts':
		case 'eth_gasPrice':
		case 'eth_getTransactionCount':
		case 'eth_multicall':
		case 'eth_getStorageAt':
		case 'eth_getLogs':
		case 'interceptor_getSimulationStack': return forwardToSigner()

		case 'personal_sign': return await personalSign(simulator, parsedRequest, request?.requestId, false)
		case 'eth_signTypedData': return await signTypedData(simulator, parsedRequest, request?.requestId, false)
		case 'eth_signTypedData_v1': return await signTypedData(simulator, parsedRequest, request?.requestId, false)
		case 'eth_signTypedData_v2': return await signTypedData(simulator, parsedRequest, request?.requestId, false)
		case 'eth_signTypedData_v3': return await signTypedData(simulator, parsedRequest, request?.requestId, false)
		case 'eth_signTypedData_v4': return await signTypedData(simulator, parsedRequest, request?.requestId, false)
		case 'wallet_switchEthereumChain': return await switchEthereumChain(simulator, parsedRequest, port, request?.requestId, false)
		case 'eth_sendTransaction': {
			if (window.interceptor.settings && isSupportedChain(window.interceptor.settings.activeChain.toString()) ) {
				return sendTransaction(getActiveAddressForDomain, simulator, parsedRequest, port, request.requestId, false)
			}
			return forwardToSigner()
		}
		default: assertUnreachable(parsedRequest)
	}
}

function newBlockCallback(blockNumber: bigint) {
	window.interceptor.currentBlockNumber = blockNumber
	sendPopupMessageToOpenWindows({ method: 'popup_new_block_arrived', data: { blockNumber } })
}

export async function changeActiveAddressAndChainAndResetSimulation(activeAddress: bigint | undefined | 'noActiveAddressChange', activeChain: bigint | 'noActiveChainChange') {
	if (window.interceptor.settings === undefined) return
	if ( simulator === undefined ) return

	let chainChanged = false
	if (activeChain !== 'noActiveChainChange') {

		window.interceptor.settings.activeChain = activeChain
		saveActiveChain(activeChain)
		const chainString = activeChain.toString()
		if (isSupportedChain(chainString)) {
			const isPolling = simulator.ethereum.isBlockPolling()
			window.interceptor.currentBlockNumber = undefined
			simulator.cleanup()
			simulator = new Simulator(chainString, isPolling, newBlockCallback)
		}

		// inform all the tabs about the chain change
		chainChanged = true
	}

	if (activeAddress !== 'noActiveAddressChange') {
		if (window.interceptor.settings.simulationMode) {
			window.interceptor.settings.activeSimulationAddress = activeAddress
			saveActiveSimulationAddress(activeAddress)
		} else {
			window.interceptor.settings.activeSigningAddress = activeAddress
			saveActiveSigningAddress(activeAddress)
		}
	}
	updateWebsiteApprovalAccesses()

	if (!await updatePrependMode(true)) {// update prepend mode as our active address has changed, so we need to be sure the rich modes money is sent to right address
		await updateSimulationState(async () => await simulator?.simulationModeNode.resetSimulation())
	}

	if (chainChanged) {
		sendMessageToApprovedWebsitePorts('chainChanged', EthereumQuantity.serialize(window.interceptor.settings.activeChain))
		sendPopupMessageToOpenWindows({ method: 'popup_chain_update' })
	}

	// inform all the tabs about the address change (this needs to be done on only chain changes too)
	sendActiveAccountChangeToApprovedWebsitePorts()
	if (activeAddress !== 'noActiveAddressChange') {
		sendPopupMessageToOpenWindows({ method: 'popup_accounts_update' })
	}
}


export async function changeActiveChain(chainId: bigint) {
	if (window.interceptor.settings === undefined) return
	if (window.interceptor.settings.simulationMode) {
		return await changeActiveAddressAndChainAndResetSimulation('noActiveAddressChange', chainId)
	}
	sendMessageToApprovedWebsitePorts('request_signer_to_wallet_switchEthereumChain', EthereumQuantity.serialize(chainId))
}

type ProviderHandler = (port: browser.runtime.Port, request: ProviderMessage) => void
const providerHandlers = new Map<string, ProviderHandler >([
	['eth_accounts_reply', ethAccountsReply],
	['signer_chainChanged', signerChainChanged],
	['wallet_switchEthereumChain_reply', walletSwitchEthereumChainReply],
	['connected_to_signer', connectedToSigner]
])

export function postMessageIfStillConnected(port: browser.runtime.Port, message: InterceptedRequestForward) {
	const tabId = port.sender?.tab?.id
	if ( tabId === undefined ) return
	if (!window.interceptor.websiteTabConnection.has(tabId)) return
	port.postMessage(message)
}

async function onContentScriptConnected(port: browser.runtime.Port) {
	console.log('content script connected')
	let connectionStatus: 'connected' | 'disconnected' | 'notInitialized' = 'notInitialized'
	port.onDisconnect.addListener(() => {
		connectionStatus = 'disconnected'
		const tabId = port.sender?.tab?.id
		if ( tabId === undefined ) return
		window.interceptor.websiteTabConnection.delete(tabId)
	})
	port.onMessage.addListener(async (payload) => {
		if (connectionStatus === 'disconnected') return

		if(!(
			'data' in payload
			&& typeof payload.data === 'object'
			&& payload.data !== null
			&& 'interceptorRequest' in payload.data
		)) return
		// received message from injected.ts page
		const request = InterceptedRequest.parse(payload.data)
		console.log(request.options.method)

		const tabId = port.sender?.tab?.id
		if ( tabId === undefined ) return

		if (!window.interceptor.websiteTabConnection.has(tabId)) {
			updateExtensionIcon(port)
		}

		try {
			const providerHandler = providerHandlers.get(request.options.method)
			if (providerHandler) {
				return providerHandler(port, request)
			}

			if (!(await verifyAccess(port, request.options.method))) {
				return postMessageIfStillConnected(port, {
					interceptorApproved: false,
					requestId: request.requestId,
					options: request.options,
					error: {
						code: METAMASK_ERROR_USER_REJECTED_REQUEST,
						message: 'User refused access to the wallet'
					}
				})
			}
			if (connectionStatus === 'notInitialized' && window.interceptor.settings?.activeChain !== undefined) {
				console.log('send connect!')
				postMessageIfStillConnected(port, {
					interceptorApproved: true,
					options: { method: 'connect' },
					result: [EthereumQuantity.serialize(window.interceptor.settings.activeChain)]
				})
				connectionStatus = 'connected'
			}
			if (!window.interceptor.settings?.simulationMode || window.interceptor.settings?.useSignersAddressAsActiveAddress) {
				// request info (chain and accounts) from the connection right away after the user has approved connection
				if (port.sender?.tab?.id !== undefined) {
					if ( window.interceptor.websiteTabSignerStates.get(port.sender.tab.id) === undefined) {
						postMessageIfStillConnected(port, {
							interceptorApproved: true,
							options: { method: 'request_signer_to_eth_requestAccounts' },
							result: []
						})
						postMessageIfStillConnected(port, {
							interceptorApproved: true,
							options: { method: 'request_signer_chainId' },
							result: []
						})
					}
				}
			}
			// if simulation mode is not on, we only intercept eth_sendTransaction and personalSign
			if ( simulator === undefined ) throw 'Interceptor not ready'

			const resolved = window.interceptor.settings?.simulationMode || request.usingInterceptorWithoutSigner ? await handleSimulationMode(simulator, port, request) : await handleSigningMode(simulator, port, request)
			if ('error' in resolved) {
				return postMessageIfStillConnected(port, {
					...resolved,
					interceptorApproved: false,
					requestId: request.requestId,
					options: request.options
				})
			}
			if (!('forward' in resolved)) {
				return postMessageIfStillConnected(port, {
					result: resolved.result,
					interceptorApproved: true,
					requestId: request.requestId,
					options: request.options
				})
			}

			return postMessageIfStillConnected(port, {
				interceptorApproved: true,
				requestId: request.requestId,
				options: request.options
			})
		} catch(error) {
			postMessageIfStillConnected(port, {
				interceptorApproved: false,
				requestId: request.requestId,
				options: request.options,
				error: {
					code: 123456,
					message: 'Unknown error'
				}
			})
			throw error
		}
	})
}

async function popupMessageHandler(simulator: Simulator, request: unknown) {
	let parsedRequest // separate request parsing and request handling. If there's a parse error, throw that to API user
	try {
		parsedRequest = PopupMessage.parse(request)
	} catch (error) {
		if (error instanceof Error) {
			return {
				error: {
					message: error.message,
					code: 400,
				}
			}
		}
		throw error
	}

	switch (parsedRequest.method) {
		case 'popup_confirmDialog': return await confirmDialog(simulator, parsedRequest)
		case 'popup_changeActiveAddress': return await changeActiveAddress(simulator, parsedRequest)
		case 'popup_changeMakeMeRich': return await changeMakeMeRich(simulator, parsedRequest)
		case 'popup_changePage': return await changePage(simulator, parsedRequest)
		case 'popup_requestAccountsFromSigner': return await requestAccountsFromSigner(simulator, parsedRequest)
		case 'popup_resetSimulation': return await resetSimulation(simulator)
		case 'popup_removeTransaction': return await removeTransaction(simulator, parsedRequest)
		case 'popup_refreshSimulation': return await refreshSimulation(simulator)
		case 'popup_refreshConfirmTransactionDialogSimulation': return await refreshPopupConfirmTransactionSimulation(simulator, parsedRequest)
		case 'popup_personalSign': return await confirmPersonalSign(simulator, parsedRequest)
		case 'popup_interceptorAccess': return await confirmRequestAccess(simulator, parsedRequest)
		case 'popup_changeInterceptorAccess': return await changeInterceptorAccess(simulator, parsedRequest)
		case 'popup_changeActiveChain': return await popupChangeActiveChain(simulator, parsedRequest)
		case 'popup_changeChainDialog': return await changeChainDialog(simulator, parsedRequest)
		case 'popup_enableSimulationMode': return await enableSimulationMode(simulator, parsedRequest)
		case 'popup_reviewNotification': return await reviewNotification(simulator, parsedRequest)
		case 'popup_rejectNotification': return await rejectNotification(simulator, parsedRequest)
		case 'popup_addOrModifyAddressBookEntry': return await addOrModifyAddressInfo(simulator, parsedRequest)
		case 'popup_getAddressBookData': return await getAddressBookData(parsedRequest, window.interceptor.settings?.userAddressBook)
		case 'popup_removeAddressBookEntry': return await removeAddressBookEntry(simulator, parsedRequest)
		case 'popup_openAddressBook': return await openAddressBook(simulator)
		case 'popup_personalSignReadyAndListening': return // handled elsewhere (personalSign.ts)
		case 'popup_changeChainReadyAndListening': return // handled elsewhere (changeChain.ts)
		case 'popup_interceptorAccessReadyAndListening': return // handled elsewhere (interceptorAccess.ts)
		case 'popup_confirmTransactionReadyAndListening': return // handled elsewhere (confirmTransaction.ts)
		default: assertUnreachable(parsedRequest)
	}
}

async function startup() {
	window.interceptor.settings = await getSettings()
	if (window.interceptor.settings.makeMeRich) {
		window.interceptor.prependTransactionMode = PrependTransactionMode.RICH_MODE
	} else {
		window.interceptor.prependTransactionMode = PrependTransactionMode.NO_PREPEND
	}

	browser.browserAction.setIcon( { path: ICON_NOT_ACTIVE } )
	browser.browserAction.setBadgeBackgroundColor( { color: '#58a5b3' } )

	// if we are using signers mode, update our active address representing to signers address
	if (window.interceptor.settings.useSignersAddressAsActiveAddress || window.interceptor.settings.simulationMode === false) {
		const signerAcc = (window.interceptor.signerAccounts && window.interceptor.signerAccounts.length > 0) ? window.interceptor.signerAccounts[0] : undefined
		if(window.interceptor.settings.simulationMode) {
			window.interceptor.settings.activeSimulationAddress = signerAcc
		} else {
			window.interceptor.settings.activeSigningAddress = signerAcc
		}
	}

	window.interceptor.websiteAccessAddressMetadata = getAddressMetadataForAccess(window.interceptor.settings.websiteAccess)

	const chainString = window.interceptor.settings.activeChain.toString()
	if (isSupportedChain(chainString)) {
		simulator = new Simulator(chainString, false, newBlockCallback)
	} else {
		simulator = new Simulator('1', false, newBlockCallback) // initialize with mainnet, if user is not using any supported chains
	}
	if (window.interceptor.settings.simulationMode) {
		changeActiveAddressAndChainAndResetSimulation(window.interceptor.settings.activeSimulationAddress, window.interceptor.settings.activeChain)
	}

	browser.runtime.onMessage.addListener(async function(message: unknown) {
		if (simulator === undefined) throw new Error('Interceptor not ready yet')
		await popupMessageHandler(simulator, message)
	})
	await setPendingAccessRequests(window.interceptor.settings.pendingAccessRequests)
}

startup()
