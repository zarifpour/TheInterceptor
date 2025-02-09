import { EthereumClientService } from '../../simulation/services/EthereumClientService.js'
import { stringifyJSONWithBigInts } from '../../utils/bigint.js'
import { METAMASK_ERROR_USER_REJECTED_REQUEST } from '../../utils/constants.js'
import { Future } from '../../utils/future.js'
import { PartiallyParsedPersonalSignRequest, PersonalSignApproval, PersonalSignRequest } from '../../types/interceptor-messages.js'
import { OpenSeaOrderMessage, PersonalSignRequestIdentifiedEIP712Message, VisualizedPersonalSignRequest } from '../../types/personal-message-definitions.js'
import { assertNever } from '../../utils/typescript.js'
import { WebsiteTabConnections } from '../../types/user-interface-types.js'
import { getHtmlFile, sendPopupMessageToOpenWindows } from '../backgroundUtils.js'
import { extractEIP712Message, validateEIP712Types } from '../../utils/eip712Parsing.js'
import { getPendingPersonalSignPromise, getRpcNetworkForChain, getTabState, setPendingPersonalSignPromise } from '../storageVariables.js'
import { getSettings } from '../settings.js'
import { PopupOrTab, addWindowTabListeners, closePopupOrTabById, getPopupOrTabOnlyById, openPopupOrTab, removeWindowTabListeners } from '../../components/ui-utils.js'
import { appendSignedMessage, simulatePersonalSign } from '../../simulation/services/SimulationModeEthereumClientService.js'
import { InterceptedRequest, UniqueRequestIdentifier, doesUniqueRequestIdentifiersMatch } from '../../utils/requests.js'
import { replyToInterceptedRequest } from '../messageSending.js'
import { identifyAddress } from '../metadataUtils.js'
import { AddressBookEntry, UserAddressBook } from '../../types/addressBookTypes.js'
import { PopupOrTabId, Website } from '../../types/websiteAccessTypes.js'
import { updateSimulationState } from '../background.js'
import { Simulator } from '../../simulation/simulator.js'
import { SignedMessageTransaction } from '../../types/visualizer-types.js'
import { SignMessageParams } from '../../types/jsonRpc-signing-types.js'
import { serialize } from '../../types/wire-types.js'
import { RpcNetwork } from '../../types/rpc.js'

let pendingPersonalSign: Future<PersonalSignApproval> | undefined = undefined

let openedDialog: PopupOrTab | undefined = undefined

export async function resolvePersonalSign(simulator: Simulator, websiteTabConnections: WebsiteTabConnections, confirmation: PersonalSignApproval) {
	if (pendingPersonalSign !== undefined) {
		pendingPersonalSign.resolve(confirmation)
	} else {
		const data = await getPendingPersonalSignPromise()
		if (data === undefined || !doesUniqueRequestIdentifiersMatch(confirmation.data.uniqueRequestIdentifier, data.signedMessageTransaction.request.uniqueRequestIdentifier)) return
		const resolved = await resolve(simulator, confirmation, data.signedMessageTransaction)
		replyToInterceptedRequest(websiteTabConnections, { ...data.signedMessageTransaction.originalRequestParameters, ...resolved, uniqueRequestIdentifier: confirmation.data.uniqueRequestIdentifier })
	}
	if (openedDialog) await closePopupOrTabById(openedDialog.popupOrTab)
	openedDialog = undefined
}

export async function updatePendingPersonalSignViewWithPendingRequests(ethereumClientService: EthereumClientService) {
	const personalSignPromise = await getPendingPersonalSignPromise()
	if (personalSignPromise === undefined) throw new Error('Missing personal sign promise from local storage')
	const settings = await getSettings()
	return await sendPopupMessageToOpenWindows(serialize(PersonalSignRequest, {
		method: 'popup_personal_sign_request' as const,
		data: await craftPersonalSignPopupMessage(ethereumClientService, personalSignPromise.signedMessageTransaction, settings.rpcNetwork, settings.userAddressBook )
	}) as PartiallyParsedPersonalSignRequest)
}

function rejectMessage(uniqueRequestIdentifier: UniqueRequestIdentifier) {
	return {
		method: 'popup_personalSignApproval',
		data: {
			uniqueRequestIdentifier,
			accept: false,
		},
	} as const
}

function reject(signingParams: SignMessageParams) {
	return {
		method: signingParams.method,
		error: {
			code: METAMASK_ERROR_USER_REJECTED_REQUEST,
			message: 'Interceptor Personal Signature: User denied personal signature.'
		}
	}
}

export async function addMetadataToOpenSeaOrder(ethereumClientService: EthereumClientService, openSeaOrder: OpenSeaOrderMessage, userAddressBook: UserAddressBook) {
	return {
		...openSeaOrder,
		zone: await identifyAddress(ethereumClientService, userAddressBook, openSeaOrder.zone),
		offerer: await identifyAddress(ethereumClientService, userAddressBook, openSeaOrder.offerer),
		offer: await Promise.all(openSeaOrder.offer.map( async (offer) => ({ ...offer, token: await identifyAddress(ethereumClientService, userAddressBook, offer.token) }))),
		consideration: await Promise.all(openSeaOrder.consideration.map(async (offer) => ({ ...offer, token: await identifyAddress(ethereumClientService, userAddressBook, offer.token), recipient: await identifyAddress(ethereumClientService, userAddressBook, offer.recipient) })))
	 }
}

export async function craftPersonalSignPopupMessage(ethereumClientService: EthereumClientService, signedMessageTransaction: SignedMessageTransaction, rpcNetwork: RpcNetwork, userAddressBook: UserAddressBook): Promise<VisualizedPersonalSignRequest> {
	const activeAddressWithMetadata = await identifyAddress(ethereumClientService, userAddressBook, signedMessageTransaction.fakeSignedFor)
	const signerName = (await getTabState(signedMessageTransaction.request.uniqueRequestIdentifier.requestSocket.tabId)).signerName
	const basicParams = { ...signedMessageTransaction, activeAddress: activeAddressWithMetadata, signerName }
	const originalParams = signedMessageTransaction

	const getQuarrantineCodes = async (messageChainId: bigint, account: AddressBookEntry, activeAddress: AddressBookEntry, owner: AddressBookEntry | undefined): Promise<{ quarantine: boolean, quarantineReasons: readonly string[] }> => {
		let quarantineReasons: string[] = []
		if (BigInt(messageChainId) !== rpcNetwork.chainId) {
			quarantineReasons.push('The signature request is for different chain than what is the current chain.')
		}
		if (account.address !== activeAddress.address || (owner != undefined && account.address !== owner.address)) {
			quarantineReasons.push('The signature request is for different account than what is your active address.')
		}
		return {
			quarantine: quarantineReasons.length > 0,
			quarantineReasons,
		}
	}
	if (originalParams.originalRequestParameters.method === 'eth_signTypedData') {
		return {
			method: originalParams.originalRequestParameters.method,
			...basicParams,
			rpcNetwork,
			type: 'NotParsed' as const,
			message: stringifyJSONWithBigInts(originalParams.originalRequestParameters.params[0], 4),
			account: await identifyAddress(ethereumClientService, userAddressBook, originalParams.originalRequestParameters.params[1]),
			quarantine: false,
			quarantineReasons: [],
			rawMessage: stringifyJSONWithBigInts(originalParams.originalRequestParameters.params[0], 4),
		}
	}

	if (originalParams.originalRequestParameters.method === 'personal_sign') {
		return {
			method: originalParams.originalRequestParameters.method,
			...basicParams,
			rpcNetwork,
			type: 'NotParsed' as const,
			message: originalParams.originalRequestParameters.params[0],
			account: await identifyAddress(ethereumClientService, userAddressBook, originalParams.originalRequestParameters.params[1]),
			quarantine: false,
			quarantineReasons: [],
			rawMessage: originalParams.originalRequestParameters.params[0],
		}
	}
	const namedParams = { param: originalParams.originalRequestParameters.params[1], account: originalParams.originalRequestParameters.params[0] }
	const account = await identifyAddress(ethereumClientService, userAddressBook, namedParams.account)
	
	const maybeParsed = PersonalSignRequestIdentifiedEIP712Message.safeParse(namedParams.param)
	if (maybeParsed.success === false) {
		// if we fail to parse the message, that means it's a message type we do not identify, let's just show it as a nonidentified EIP712 message
		if (validateEIP712Types(namedParams.param) === false) throw new Error('Not a valid EIP712 Message')
		const message = await extractEIP712Message(ethereumClientService, namedParams.param, userAddressBook)
		const chainid = message.domain.chainId?.type === 'integer' ? BigInt(message.domain.chainId?.value) : undefined
		return {
			method: originalParams.originalRequestParameters.method,
			...basicParams,
			rpcNetwork: chainid !== undefined && rpcNetwork.chainId !== chainid ? await getRpcNetworkForChain(chainid) : rpcNetwork,
			type: 'EIP712' as const,
			message,
			account,
			...chainid === undefined ? { quarantine: false, quarantineReasons: [] } : await getQuarrantineCodes(chainid, account, activeAddressWithMetadata, undefined),
			rawMessage: stringifyJSONWithBigInts(namedParams.param, 4),
		}
	}
	const parsed = maybeParsed.value
	switch (parsed.primaryType) {
		case 'Permit': {
			const token = await identifyAddress(ethereumClientService, userAddressBook, parsed.domain.verifyingContract)
			const owner = await identifyAddress(ethereumClientService, userAddressBook, parsed.message.owner)
			if (token.type === 'ERC721') throw 'Attempted to perform Permit to an ERC721'
			if (token.type === 'ERC1155') throw 'Attempted to perform Permit to an ERC1155'
			return {
				method: originalParams.originalRequestParameters.method,
				...basicParams,
				rpcNetwork: rpcNetwork.chainId !== parsed.domain.chainId ? await getRpcNetworkForChain(parsed.domain.chainId) : rpcNetwork,
				type: 'Permit' as const,
				message: parsed,
				account,
				owner,
				spender: await identifyAddress(ethereumClientService, userAddressBook, parsed.message.spender),
				verifyingContract: token,
				...await getQuarrantineCodes(BigInt(parsed.domain.chainId), account, activeAddressWithMetadata, owner),
				rawMessage: stringifyJSONWithBigInts(parsed, 4),
			}
		}
		case 'PermitSingle': {
			const token = await identifyAddress(ethereumClientService, userAddressBook, parsed.message.details.token)
			if (token.type === 'ERC721') throw 'Attempted to perform Permit to an ERC721'
			if (token.type === 'ERC1155') throw 'Attempted to perform Permit to an ERC1155'
			return {
				method: originalParams.originalRequestParameters.method,
				...basicParams,
				rpcNetwork: rpcNetwork.chainId !== parsed.domain.chainId ? await getRpcNetworkForChain(parsed.domain.chainId) : rpcNetwork,
				type: 'Permit2' as const,
				message: parsed,
				account,
				token: token,
				spender: await identifyAddress(ethereumClientService, userAddressBook, parsed.message.spender),
				verifyingContract: await identifyAddress(ethereumClientService, userAddressBook, parsed.domain.verifyingContract),
				...await getQuarrantineCodes(parsed.domain.chainId, account, activeAddressWithMetadata, undefined),
				rawMessage: stringifyJSONWithBigInts(parsed, 4),
			}
		}
		case 'SafeTx': return {
			method: originalParams.originalRequestParameters.method,
			...basicParams,
			rpcNetwork: parsed.domain.chainId !== undefined && rpcNetwork.chainId !== parsed.domain.chainId ? await getRpcNetworkForChain(parsed.domain.chainId) : rpcNetwork,
			type: 'SafeTx' as const,
			message: parsed,
			account,
			to: await identifyAddress(ethereumClientService, userAddressBook, parsed.message.to),
			gasToken: await identifyAddress(ethereumClientService, userAddressBook, parsed.message.gasToken),
			refundReceiver: await identifyAddress(ethereumClientService, userAddressBook, parsed.message.refundReceiver),
			verifyingContract: await identifyAddress(ethereumClientService, userAddressBook, parsed.domain.verifyingContract),
			quarantine: false,
			quarantineReasons: [],
			rawMessage: stringifyJSONWithBigInts(parsed, 4),
		}
		case 'OrderComponents': return {
			method: originalParams.originalRequestParameters.method,
			...basicParams,
			type: 'OrderComponents' as const,
			rpcNetwork: rpcNetwork.chainId !== parsed.domain.chainId ? await getRpcNetworkForChain(parsed.domain.chainId) : rpcNetwork,
			message: await addMetadataToOpenSeaOrder(ethereumClientService, parsed.message, userAddressBook),
			account,
			...await getQuarrantineCodes(parsed.domain.chainId, account, activeAddressWithMetadata, undefined),
			rawMessage: stringifyJSONWithBigInts(parsed, 4),
		}
		default: assertNever(parsed)
	}
}

export const openPersonalSignDialog = async (
	simulator: Simulator,
	websiteTabConnections: WebsiteTabConnections,
	signingParams: SignMessageParams,
	request: InterceptedRequest,
	simulationMode: boolean,
	website: Website,
	activeAddress: bigint | undefined
) => {

	const onCloseWindowOrTab = async (popupOrTabs: PopupOrTabId) => {
		if (openedDialog === undefined || openedDialog.popupOrTab.id !== popupOrTabs.id || openedDialog.popupOrTab.type !== popupOrTabs.type) return
		if (pendingPersonalSign === undefined) return
		openedDialog = undefined
		return await resolvePersonalSign(simulator, websiteTabConnections, rejectMessage(request.uniqueRequestIdentifier))
	}
	const onCloseWindow = async (id: number) => await onCloseWindowOrTab({ type: 'popup' as const, id })
	const onCloseTab = async (id: number) => await onCloseWindowOrTab({ type: 'tab' as const, id })

	if (activeAddress === undefined) return reject(signingParams)
	const signedMessageTransaction = {
		website,
		created: new Date(),
		originalRequestParameters: signingParams,
		fakeSignedFor: activeAddress,
		simulationMode,
		request,
	}

	pendingPersonalSign = new Future<PersonalSignApproval>()
	try {
		const oldPromise = await getPendingPersonalSignPromise()
		if (oldPromise !== undefined) {
			if (await getPopupOrTabOnlyById(oldPromise.popupOrTabId) !== undefined) {
				return reject(signingParams)
			} else {
				await setPendingPersonalSignPromise(undefined)
			}
		}

		openedDialog = await openPopupOrTab({
			url: getHtmlFile('personalSign'),
			type: 'popup',
			height: 800,
			width: 600,
		})
		if (openedDialog !== undefined) {
			addWindowTabListeners(onCloseWindow, onCloseTab)

			await setPendingPersonalSignPromise({
				popupOrTabId: openedDialog.popupOrTab,
				signedMessageTransaction,
			})
			await updatePendingPersonalSignViewWithPendingRequests(simulator.ethereum)
		} else {
			await resolvePersonalSign(simulator, websiteTabConnections, rejectMessage(request.uniqueRequestIdentifier))
		}

		const reply = await pendingPersonalSign

		return resolve(simulator, reply, signedMessageTransaction)
	} finally {
		removeWindowTabListeners(onCloseWindow, onCloseTab)
		pendingPersonalSign = undefined
	}
}

async function resolve(simulator: Simulator, reply: PersonalSignApproval, signedMessageTransaction: SignedMessageTransaction) {
	await setPendingPersonalSignPromise(undefined)
	// forward message to content script
	if (reply.data.accept) {
		if (signedMessageTransaction.simulationMode) {
			await updateSimulationState(simulator.ethereum, async (simulationState) => {
				return await appendSignedMessage(simulator.ethereum, simulationState, signedMessageTransaction)
			}, signedMessageTransaction.fakeSignedFor, true)
			const signedMessage = (await simulatePersonalSign(signedMessageTransaction.originalRequestParameters, signedMessageTransaction.fakeSignedFor)).signature
			return { result: signedMessage, method: signedMessageTransaction.originalRequestParameters.method }
		}
		return { forward: true, ...signedMessageTransaction.originalRequestParameters } as const
	}
	return reject(signedMessageTransaction.originalRequestParameters)
}
