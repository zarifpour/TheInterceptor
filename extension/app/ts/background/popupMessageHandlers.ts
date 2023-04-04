import { changeActiveAddressAndChainAndResetSimulation, changeActiveChain, refreshConfirmTransactionSimulation, updatePrependMode, updateSimulationState } from './background.js'
import { getCurrentTabId, getMakeMeRich, getOpenedAddressBookTabId, getSettings, getSignerName, getSimulationResults, getTabState, saveCurrentTabId, setMakeMeRich, setOpenedAddressBookTabId, setPage, setSimulationMode, setUseSignersAddressAsActiveAddress, updateAddressInfos, updateContacts, updateWebsiteAccess } from './settings.js'
import { Simulator } from '../simulation/simulator.js'
import { ChangeActiveAddress, ChangeMakeMeRich, ChangePage, PersonalSign, RemoveTransaction, RequestAccountsFromSigner, TransactionConfirmation, InterceptorAccess, ChangeInterceptorAccess, ChainChangeConfirmation, EnableSimulationMode, ReviewNotification, RejectNotification, ChangeActiveChain, AddOrEditAddressBookEntry, GetAddressBookData, RemoveAddressBookEntry, RefreshConfirmTransactionDialogSimulation, UserAddressBook, InterceptorAccessRefresh, InterceptorAccessChangeAddress, Settings } from '../utils/interceptor-messages.js'
import { resolvePendingTransaction } from './windows/confirmTransaction.js'
import { resolvePersonalSign } from './windows/personalSign.js'
import { changeAccess, getAddressMetadataForAccess, removePendingAccessRequestAndUpdateBadge, requestAccessFromUser, requestAddressChange, resolveExistingInterceptorAccessAsNoResponse, resolveInterceptorAccess } from './windows/interceptorAccess.js'
import { resolveChainChange } from './windows/changeChain.js'
import { getAssociatedAddresses, sendMessageToApprovedWebsitePorts, updateWebsiteApprovalAccesses } from './accessManagement.js'
import { getHtmlFile, sendPopupMessageToOpenWindows } from './backgroundUtils.js'
import { isSupportedChain } from '../utils/constants.js'
import { getMetadataForAddressBookData } from './medataSearch.js'
import { findAddressInfo } from './metadataUtils.js'
import { assertUnreachable } from '../utils/typescript.js'
import { addressString } from '../utils/bigint.js'
import { AddressInfoEntry, WebsiteTabConnections } from '../utils/user-interface-types.js'
import { EthereumClientService } from '../simulation/services/EthereumClientService.js'
import { SimulationState } from '../utils/visualizer-types.js'
import { refreshSimulationState, removeTransactionAndUpdateTransactionNonces, resetSimulationState } from '../simulation/services/SimulationModeEthereumClientService.js'

export async function confirmDialog(websiteTabConnections: WebsiteTabConnections, confirmation: TransactionConfirmation) {
	await resolvePendingTransaction(websiteTabConnections, confirmation.options.accept ? 'Approved' : 'Rejected')
}

export async function confirmPersonalSign(websiteTabConnections: WebsiteTabConnections, confirmation: PersonalSign) {
	await resolvePersonalSign(websiteTabConnections, confirmation)
}

export async function confirmRequestAccess(websiteTabConnections: WebsiteTabConnections, confirmation: InterceptorAccess) {
	await resolveInterceptorAccess(websiteTabConnections, confirmation.options)
}

export async function getLastKnownCurrentTabId() {
	const tabId = getCurrentTabId()
	const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true })
	if (tabs[0]?.id === undefined) {
		return await tabId
	}
	if (await tabId !== tabs[0].id) {
		saveCurrentTabId(tabs[0].id)
	}
	return tabs[0].id
}

export async function getSignerAccount() {
	const tabId = await getLastKnownCurrentTabId()
	const signerAccounts = tabId === undefined ? undefined : (await getTabState(tabId)).signerAccounts
	return signerAccounts !== undefined && signerAccounts.length > 0 ? signerAccounts[0] : undefined
}

export async function changeActiveAddress(websiteTabConnections: WebsiteTabConnections, addressChange: ChangeActiveAddress) {
	await setUseSignersAddressAsActiveAddress(addressChange.options === 'signer')

	// if using signers address, set the active address to signers address if available, otherwise we don't know active address and set it to be undefined
	if (addressChange.options === 'signer') {
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_to_eth_requestAccounts', [])
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_chainId', [])
		await changeActiveAddressAndChainAndResetSimulation(websiteTabConnections, await getSignerAccount(), 'noActiveChainChange', await getSettings())
	} else {
		await changeActiveAddressAndChainAndResetSimulation(websiteTabConnections, addressChange.options, 'noActiveChainChange', await getSettings())
	}
}

export async function changeMakeMeRich(ethereumClientService: EthereumClientService, simulationState: SimulationState, makeMeRichChange: ChangeMakeMeRich, settings: Settings) {
	await setMakeMeRich(makeMeRichChange.options)
	await updatePrependMode(ethereumClientService, simulationState, settings)
}

export async function removeAddressBookEntry(websiteTabConnections: WebsiteTabConnections, removeAddressBookEntry: RemoveAddressBookEntry) {
	switch(removeAddressBookEntry.options.addressBookCategory) {
		case 'My Active Addresses': {
			await updateAddressInfos((previousAddressInfos) => previousAddressInfos.filter((info) => info.address !== removeAddressBookEntry.options.address))
			updateWebsiteApprovalAccesses(websiteTabConnections, undefined, await getSettings())
			return await sendPopupMessageToOpenWindows({ method: 'popup_addressBookEntriesChanged' })
		}
		case 'My Contacts': {
			await updateContacts((previousContacts) => previousContacts.filter((contact) => contact.address !== removeAddressBookEntry.options.address))
			return await sendPopupMessageToOpenWindows({ method: 'popup_addressBookEntriesChanged' })
		}
		case 'Non Fungible Tokens':
		case 'Other Contracts':
		case 'Tokens': throw new Error('Tried to remove addressbook category that is not supported yet!')
		default: assertUnreachable(removeAddressBookEntry.options.addressBookCategory)
	}
}

export async function addOrModifyAddressInfo(websiteTabConnections: WebsiteTabConnections, entry: AddOrEditAddressBookEntry) {
	const newEntry = entry.options
	switch (newEntry.type) {
		case 'NFT':
		case 'other contract':
		case 'token': throw new Error(`No support to modify this entry yet! ${ newEntry.type }`)
		case 'addressInfo': {
			await updateAddressInfos((previousAddressInfos) => {
				if (previousAddressInfos.find((x) => x.address === entry.options.address) ) {
					return previousAddressInfos.map((x) => x.address === newEntry.address ? newEntry : x )
				} else {
					return previousAddressInfos.concat([newEntry])
				}
			})
			updateWebsiteApprovalAccesses(websiteTabConnections, undefined, await getSettings())
			return await sendPopupMessageToOpenWindows({ method: 'popup_addressBookEntriesChanged' })
		}
		case 'contact': {
			await updateContacts((previousContacts) => {
				if (previousContacts.find( (x) => x.address === entry.options.address) ) {
					return previousContacts.map( (x) => x.address === newEntry.address ? newEntry : x )
				} else {
					return previousContacts.concat([newEntry])
				}
			})
			return await sendPopupMessageToOpenWindows({ method: 'popup_addressBookEntriesChanged' })
		}
		default: assertUnreachable(newEntry)
	}
}

export async function changeInterceptorAccess(websiteTabConnections: WebsiteTabConnections, accessChange: ChangeInterceptorAccess) {
	await updateWebsiteAccess(() => accessChange.options) // TODO: update 'popup_changeInterceptorAccess' to return list of changes instead of a new list
	updateWebsiteApprovalAccesses(websiteTabConnections, undefined, await getSettings())
	return await sendPopupMessageToOpenWindows({ method: 'popup_interceptor_access_changed' })
}

export async function changePage(page: ChangePage) {
	await setPage(page.options)
}

export async function requestAccountsFromSigner(websiteTabConnections: WebsiteTabConnections, params: RequestAccountsFromSigner) {
	if (params.options) {
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_to_eth_requestAccounts', [])
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_chainId', [])
	}
}

export async function resetSimulation(ethereumClientService: EthereumClientService, simulationState: SimulationState, settings: Settings) {
	await updateSimulationState(async () => await resetSimulationState(ethereumClientService, simulationState), settings.activeSimulationAddress)
}

export async function removeTransaction(ethereumClientService: EthereumClientService, simulationState: SimulationState, params: RemoveTransaction, settings: Settings) {
	await updateSimulationState(async () => await removeTransactionAndUpdateTransactionNonces(ethereumClientService, simulationState, params.options), settings.activeSimulationAddress)
}

export async function refreshSimulation(ethereumClientService: EthereumClientService, simulationState: SimulationState, settings: Settings) {
	await updateSimulationState(async() => await refreshSimulationState(ethereumClientService, simulationState), settings.activeSimulationAddress)
}

export async function refreshPopupConfirmTransactionSimulation(ethereumClientService: EthereumClientService, simulationState: SimulationState, { data }: RefreshConfirmTransactionDialogSimulation) {
	const refreshMessage = await refreshConfirmTransactionSimulation(ethereumClientService, simulationState, data.activeAddress, data.simulationMode, data.requestId, data.transactionToSimulate, data.website, (await getSettings()).userAddressBook)
	if (refreshMessage === undefined) return
	return await sendPopupMessageToOpenWindows(refreshMessage)
}

export async function popupChangeActiveChain(websiteTabConnections: WebsiteTabConnections, params: ChangeActiveChain) {
	await changeActiveChain(websiteTabConnections, params.options)
}

export async function changeChainDialog(websiteTabConnections: WebsiteTabConnections, chainChange: ChainChangeConfirmation) {
	await resolveChainChange(websiteTabConnections, chainChange)
}

export async function enableSimulationMode(websiteTabConnections: WebsiteTabConnections, params: EnableSimulationMode) {
	await setSimulationMode(params.options)
	const settings = await getSettings()
	// if we are on unsupported chain, force change to a supported one
	if (settings.useSignersAddressAsActiveAddress || params.options === false) {
		const tabId = await getLastKnownCurrentTabId()
		const chainToSwitch = tabId === undefined ? undefined : (await getTabState(tabId)).signerChain 
		await changeActiveAddressAndChainAndResetSimulation(websiteTabConnections, await getSignerAccount(), chainToSwitch === undefined ? 'noActiveChainChange' : chainToSwitch, settings)
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_to_eth_requestAccounts', [])
		sendMessageToApprovedWebsitePorts(websiteTabConnections, 'request_signer_chainId', [])
	} else {
		const chainToSwitch = isSupportedChain(settings.activeChain.toString()) ? settings.activeChain : 1n
		await changeActiveAddressAndChainAndResetSimulation(websiteTabConnections, settings.simulationMode ? settings.activeSimulationAddress : settings.activeSigningAddress, chainToSwitch, settings)
	}
}

export async function reviewNotification(websiteTabConnections: WebsiteTabConnections, params: ReviewNotification, settings: Settings) {
	const notification = settings.pendingAccessRequests.find( (x) => x.website.websiteOrigin === params.options.website.websiteOrigin && x.requestAccessToAddress === params.options.requestAccessToAddress)
	if (notification === undefined) return
	await resolveExistingInterceptorAccessAsNoResponse(websiteTabConnections)

	const addressInfo = notification.requestAccessToAddress === undefined ? undefined : findAddressInfo(BigInt(notification.requestAccessToAddress), settings.userAddressBook.addressInfos)
	const metadata = getAssociatedAddresses(settings, notification.website.websiteOrigin, addressInfo)
	await requestAccessFromUser(websiteTabConnections, params.options.socket, notification.website, params.options.request, addressInfo, metadata, settings)
}
export async function rejectNotification(websiteTabConnections: WebsiteTabConnections, params: RejectNotification) {
	if (params.options.removeOnly) {
		await removePendingAccessRequestAndUpdateBadge(params.options.website.websiteOrigin, params.options.requestAccessToAddress)
	}

	await resolveInterceptorAccess(websiteTabConnections, {
		websiteOrigin : params.options.website.websiteOrigin,
		requestAccessToAddress: params.options.requestAccessToAddress,
		originalRequestAccessToAddress: params.options.requestAccessToAddress,
		approval: params.options.removeOnly ? 'NoResponse' : 'Rejected'
	}) // close pending access for this request if its open
	if (!params.options.removeOnly) {
		await changeAccess(websiteTabConnections, {
			websiteOrigin : params.options.website.websiteOrigin,
			requestAccessToAddress: params.options.requestAccessToAddress,
			originalRequestAccessToAddress: params.options.requestAccessToAddress,
			approval: 'Rejected'
		}, params.options.website )
	}
	await sendPopupMessageToOpenWindows({ method: 'popup_notification_removed' })
}

export async function getAddressBookData(parsed: GetAddressBookData, userAddressBook: UserAddressBook | undefined) {
	if (userAddressBook === undefined) throw new Error('Interceptor is not ready')
	const data = getMetadataForAddressBookData(parsed.options, userAddressBook)
	await sendPopupMessageToOpenWindows({
		method: 'popup_getAddressBookDataReply',
		data: {
			options: parsed.options,
			entries: data.entries,
			maxDataLength: data.maxDataLength,
		}
	})
}

export async function openAddressBook() {
	const openInNewTab = async () => {
		const tab = await browser.tabs.create({ url: getHtmlFile('addressBook') })
		if (tab.id !== undefined) await setOpenedAddressBookTabId(tab.id)
	}

	const tabId = await getOpenedAddressBookTabId()
	if (tabId === undefined) return await openInNewTab()
	const allTabs = await browser.tabs.query({})
	const addressBookTab = allTabs.find((tab) => tab.id === tabId)

	if (addressBookTab?.id === undefined) return await openInNewTab()
	return await browser.tabs.update(addressBookTab.id, { active: true })
}

export async function homeOpened(simulator: Simulator) {
	const tabId = await getLastKnownCurrentTabId()
	const tabState = tabId === undefined ? undefined : await getTabState(tabId)

	const settings = await getSettings()
	const pendingAccessRequestsAddresses = new Set(settings.pendingAccessRequests.map((x) => x.requestAccessToAddress === undefined ? [] : x.requestAccessToAddress).flat())
	const addressInfos = settings.userAddressBook.addressInfos
	const pendingAccessMetadata: [string, AddressInfoEntry][] = Array.from(pendingAccessRequestsAddresses).map((x) => [addressString(x), findAddressInfo(BigInt(x), addressInfos)])

	await sendPopupMessageToOpenWindows({
		method: 'popup_UpdateHomePage',
		data: {
			simulation: await getSimulationResults(),
			websiteAccessAddressMetadata: getAddressMetadataForAccess(settings.websiteAccess, settings.userAddressBook.addressInfos),
			pendingAccessMetadata: pendingAccessMetadata,
			signerAccounts: tabState?.signerAccounts,
			signerChain: tabState?.signerChain,
			signerName: await getSignerName(),
			currentBlockNumber: await simulator.ethereum.getBlockNumber(),
			settings: settings,
			tabIconDetails: tabState?.tabIconDetails,
			makeMeRich: await getMakeMeRich()
		}
	})
}

export async function interceptorAccessChangeAddressOrRefresh(websiteTabConnections: WebsiteTabConnections, params: InterceptorAccessChangeAddress | InterceptorAccessRefresh) {
	await requestAddressChange(websiteTabConnections, params)
}
