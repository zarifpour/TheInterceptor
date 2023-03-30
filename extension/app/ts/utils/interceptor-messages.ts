import * as funtypes from 'funtypes'
import { AddressBookEntries, AddressBookEntry, AddressInfo, AddressInfoEntry, ContactEntries, Website, WebsiteSocket } from './user-interface-types.js'
import { EIP2612Message, EthereumAddress, EthereumQuantity, EthereumUnsignedTransaction, Permit2, PersonalSignParams, SignTypedDataParams } from './wire-types.js'
import { SimulationState, TokenPriceEstimate, SimResults } from './visualizer-types.js'

export type MessageMethodAndParams = funtypes.Static<typeof MessageMethodAndParams>
export const MessageMethodAndParams = funtypes.Union(
	funtypes.Object({
		method: funtypes.String,
		params: funtypes.Union(funtypes.Array(funtypes.Unknown), funtypes.Undefined)
	}).asReadonly(),
	funtypes.Object({ method: funtypes.String }).asReadonly()
)

export type InterceptedRequest = funtypes.Static<typeof InterceptedRequest>
export const InterceptedRequest = funtypes.Intersect(
	funtypes.Object({
		interceptorRequest: funtypes.Boolean,
		usingInterceptorWithoutSigner: funtypes.Boolean,
		options: MessageMethodAndParams,
		requestId: funtypes.Number,
	}).asReadonly()
)
export type ProviderMessage = InterceptedRequest

export type InterceptedRequestForward = funtypes.Static<typeof InterceptedRequestForward>
export const InterceptedRequestForward = funtypes.Intersect(
	funtypes.Object({
		interceptorApproved: funtypes.Boolean,
		options: MessageMethodAndParams,
	}).asReadonly(),
	funtypes.Union(
		funtypes.Object({
			result: funtypes.Unknown,
		}),
		funtypes.Object({
			error: funtypes.Object({
				code: funtypes.Number,
				message: funtypes.String
			}).asReadonly(),
		}).asReadonly(),
		funtypes.Object({ })
	),
	funtypes.Partial({
		subscription: funtypes.String,
		usingInterceptorWithoutSigner: funtypes.Boolean,
		requestId: funtypes.Number}).asReadonly()
)

export type TransactionConfirmation = funtypes.Static<typeof TransactionConfirmation>
export const TransactionConfirmation = funtypes.Object({
	method: funtypes.Literal('popup_confirmDialog'),
	options: funtypes.Object({
		requestId: funtypes.Number,
		accept: funtypes.Boolean
	})
}).asReadonly()

export type PersonalSign = funtypes.Static<typeof PersonalSign>
export const PersonalSign = funtypes.Object({
	method: funtypes.Literal('popup_personalSign'),
	options: funtypes.Object({
		requestId: funtypes.Number,
		accept: funtypes.Boolean
	})
}).asReadonly()

export type InterceptorAccessRefresh = funtypes.Static<typeof InterceptorAccessRefresh>
export const InterceptorAccessRefresh = funtypes.Object({
	method: funtypes.Literal('popup_interceptorAccessRefresh'),
	options: funtypes.Object({
		socket: WebsiteSocket,
		website: Website,
		requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
	}),
}).asReadonly()

export type InterceptorAccessChangeAddress = funtypes.Static<typeof InterceptorAccessChangeAddress>
export const InterceptorAccessChangeAddress = funtypes.Object({
	method: funtypes.Literal('popup_interceptorAccessChangeAddress'),
	options: funtypes.Object({
		socket: WebsiteSocket,
		website: Website,
		requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
		newActiveAddress: funtypes.Union(EthereumAddress, funtypes.Literal('signer')),
	}),
}).asReadonly()

export type InterceptorAccessReply = funtypes.Static<typeof InterceptorAccessReply>
export const InterceptorAccessReply = funtypes.Object({
	websiteOrigin: funtypes.String,
	originalRequestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
	requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
	approval: funtypes.Union(funtypes.Literal('Approved'), funtypes.Literal('Rejected'), funtypes.Literal('NoResponse') ),
})

export type InterceptorAccess = funtypes.Static<typeof InterceptorAccess>
export const InterceptorAccess = funtypes.Object({
	method: funtypes.Literal('popup_interceptorAccess'),
	options: InterceptorAccessReply,
}).asReadonly()

export type ChangeActiveAddress = funtypes.Static<typeof ChangeActiveAddress>
export const ChangeActiveAddress = funtypes.Object({
	method: funtypes.Literal('popup_changeActiveAddress'),
	options: funtypes.Union(EthereumAddress, funtypes.Literal('signer')),
}).asReadonly()

export type ChangeMakeMeRich = funtypes.Static<typeof ChangeMakeMeRich>
export const ChangeMakeMeRich = funtypes.Object({
	method: funtypes.Literal('popup_changeMakeMeRich'),
	options: funtypes.Boolean
}).asReadonly()

export type AddressBookCategory = funtypes.Static<typeof AddressBookCategory>
export const AddressBookCategory = funtypes.Union(
	funtypes.Literal('My Active Addresses'),
	funtypes.Literal('My Contacts'),
	funtypes.Literal('Tokens'),
	funtypes.Literal('Non Fungible Tokens'),
	funtypes.Literal('Other Contracts')
)

export type RemoveAddressBookEntry = funtypes.Static<typeof RemoveAddressBookEntry>
export const RemoveAddressBookEntry = funtypes.Object({
	method: funtypes.Literal('popup_removeAddressBookEntry'),
	options: funtypes.Object({
		address: EthereumAddress,
		addressBookCategory: AddressBookCategory,
	})
}).asReadonly()

export type AddOrEditAddressBookEntry = funtypes.Static<typeof AddOrEditAddressBookEntry>
export const AddOrEditAddressBookEntry = funtypes.Object({
	method: funtypes.Literal('popup_addOrModifyAddressBookEntry'),
	options: AddressBookEntry,
}).asReadonly()

export const pages = ['Home', 'AddNewAddress', 'ChangeActiveAddress', 'AccessList', 'NotificationCenter', 'ModifyAddress']
export type Page = funtypes.Static<typeof Page>
export const Page = funtypes.Union(
	funtypes.Literal('Home'),
	funtypes.Literal('AddNewAddress'),
	funtypes.Literal('ChangeActiveAddress'),
	funtypes.Literal('AccessList'),
	funtypes.Literal('NotificationCenter'),
	funtypes.Literal('ModifyAddress'),
)

export type ChangePage = funtypes.Static<typeof ChangePage>
export const ChangePage = funtypes.Object({
	method: funtypes.Literal('popup_changePage'),
	options: Page,
}).asReadonly()

export type RequestAccountsFromSigner = funtypes.Static<typeof RequestAccountsFromSigner>
export const RequestAccountsFromSigner = funtypes.Object({
	method: funtypes.Literal('popup_requestAccountsFromSigner'),
	options: funtypes.Boolean
}).asReadonly()

export type EnableSimulationMode = funtypes.Static<typeof EnableSimulationMode>
export const EnableSimulationMode = funtypes.Object({
	method: funtypes.Literal('popup_enableSimulationMode'),
	options: funtypes.Boolean
}).asReadonly()

export type RemoveTransaction = funtypes.Static<typeof RemoveTransaction>
export const RemoveTransaction = funtypes.Object({
	method: funtypes.Literal('popup_removeTransaction'),
	options: EthereumQuantity,
}).asReadonly()

export type ResetSimulation = funtypes.Static<typeof ResetSimulation>
export const ResetSimulation = funtypes.Object({
	method: funtypes.Literal('popup_resetSimulation')
}).asReadonly()

export type RefreshSimulation = funtypes.Static<typeof RefreshSimulation>
export const RefreshSimulation = funtypes.Object({
	method: funtypes.Literal('popup_refreshSimulation')
}).asReadonly()

export type ChangeInterceptorAccess = funtypes.Static<typeof ChangeInterceptorAccess>
export const ChangeInterceptorAccess = funtypes.Object({
	method: funtypes.Literal('popup_changeInterceptorAccess'),
	options: funtypes.ReadonlyArray(
		funtypes.Object({
			website: Website,
			access: funtypes.Boolean,
			addressAccess: funtypes.Union(
				funtypes.ReadonlyArray(funtypes.Object( {
					address: EthereumAddress,
					access: funtypes.Boolean,
				} ))
			, funtypes.Undefined),
		})
	)
}).asReadonly()

export type ChangeActiveChain = funtypes.Static<typeof ChangeActiveChain>
export const ChangeActiveChain = funtypes.Object({
	method: funtypes.Literal('popup_changeActiveChain'),
	options: EthereumQuantity,
}).asReadonly()

export type ChainChangeConfirmation = funtypes.Static<typeof ChainChangeConfirmation>
export const ChainChangeConfirmation = funtypes.Object({
	method: funtypes.Literal('popup_changeChainDialog'),
	options: funtypes.Union(
		funtypes.Object({
			chainId: EthereumQuantity,
			requestId: funtypes.Number,
			accept: funtypes.Literal(true),
		}),
		funtypes.Object({
			requestId: funtypes.Number,
			accept: funtypes.Literal(false),
		}),
	)
}).asReadonly()

export type SignerChainChangeConfirmation = funtypes.Static<typeof SignerChainChangeConfirmation>
export const SignerChainChangeConfirmation = funtypes.Object({
	method: funtypes.Literal('popup_signerChangeChainDialog'),
	options: funtypes.Object({
		chainId: EthereumQuantity,
		accept: funtypes.Boolean,
	})
}).asReadonly()

export type SignerName = funtypes.Static<typeof SignerName>
export const SignerName = funtypes.Union(
	funtypes.Literal('NoSigner'),
	funtypes.Literal('NotRecognizedSigner'),
	funtypes.Literal('MetaMask'),
	funtypes.Literal('Brave'),
	funtypes.Literal('NoSignerDetected'),
)

export type ConnectedToSigner = funtypes.Static<typeof ConnectedToSigner>
export const ConnectedToSigner = funtypes.Object({
	method: funtypes.Literal('connected_to_signer'),
	params: funtypes.Tuple(SignerName),
}).asReadonly()

export type WalletSwitchEthereumChainReply = funtypes.Static<typeof WalletSwitchEthereumChainReply>
export const WalletSwitchEthereumChainReply = funtypes.Object({
	method: funtypes.Literal('wallet_switchEthereumChain_reply'),
	params: funtypes.Tuple(funtypes.Object({
		accept: funtypes.Boolean,
		chainId: EthereumQuantity,
	}))
}).asReadonly()

export type ReviewNotification = funtypes.Static<typeof ReviewNotification>
export const ReviewNotification = funtypes.Object({
	method: funtypes.Literal('popup_reviewNotification'),
	options: funtypes.Object({
		website: Website,
		requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
		socket: WebsiteSocket,
		request: funtypes.Union(InterceptedRequest, funtypes.Undefined),
	})
}).asReadonly()

export type RejectNotification = funtypes.Static<typeof RejectNotification>
export const RejectNotification = funtypes.Object({
	method: funtypes.Literal('popup_rejectNotification'),
	options: funtypes.Object({
		website: Website,
		requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
		removeOnly: funtypes.Boolean,
	})
}).asReadonly()

export type GetAddressBookDataFilter = funtypes.Static<typeof GetAddressBookDataFilter>
export const GetAddressBookDataFilter = funtypes.Intersect(
	funtypes.Object({
		filter: AddressBookCategory,
		startIndex: funtypes.Number,
		maxIndex: funtypes.Number,
	}).asReadonly(),
	funtypes.Partial({
		searchString: funtypes.String,
	}).asReadonly()
)

export type GetAddressBookData = funtypes.Static<typeof GetAddressBookData>
export const GetAddressBookData = funtypes.Object({
	method: funtypes.Literal('popup_getAddressBookData'),
	options: GetAddressBookDataFilter,
}).asReadonly()

export type OpenAddressBook = funtypes.Static<typeof OpenAddressBook>
export const OpenAddressBook = funtypes.Object({
	method: funtypes.Literal('popup_openAddressBook'),
}).asReadonly()

export type GetAddressBookDataReplyData = funtypes.Static<typeof GetAddressBookDataReplyData>
export const GetAddressBookDataReplyData = funtypes.Object({
	options: GetAddressBookDataFilter,
	entries: AddressBookEntries,
	maxDataLength: funtypes.Number,
}).asReadonly()

export type GetAddressBookDataReply = funtypes.Static<typeof GetAddressBookDataReply>
export const GetAddressBookDataReply = funtypes.Object({
	method: funtypes.Literal('popup_getAddressBookDataReply'),
	data: GetAddressBookDataReplyData,
}).asReadonly()


export type RefreshConfirmTransactionDialogSimulation = funtypes.Static<typeof RefreshConfirmTransactionDialogSimulation>
export const RefreshConfirmTransactionDialogSimulation = funtypes.Object({
	method: funtypes.Literal('popup_refreshConfirmTransactionDialogSimulation'),
	data: funtypes.Object({
		activeAddress: EthereumAddress,
		simulationMode: funtypes.Boolean,
		requestId: funtypes.Number,
		transactionToSimulate: EthereumUnsignedTransaction,
		website: Website,
	}),
}).asReadonly()

export type NewBlockArrived = funtypes.Static<typeof NewBlockArrived>
export const NewBlockArrived = funtypes.Object({
	method: funtypes.Literal('popup_new_block_arrived'),
	data: funtypes.Object({
		blockNumber: EthereumQuantity,
	}),
}).asReadonly()

export type PopupMessage = funtypes.Static<typeof PopupMessage>
export const PopupMessage = funtypes.Union(
	ChangeMakeMeRich,
	ChangeActiveAddress,
	TransactionConfirmation,
	ChangePage,
	RequestAccountsFromSigner,
	RemoveTransaction,
	ResetSimulation,
	RefreshSimulation,
	RefreshConfirmTransactionDialogSimulation,
	PersonalSign,
	InterceptorAccess,
	InterceptorAccessRefresh,
	InterceptorAccessChangeAddress,
	ChangeInterceptorAccess,
	ChangeActiveChain,
	ChainChangeConfirmation,
	EnableSimulationMode,
	RejectNotification,
	ReviewNotification,
	AddOrEditAddressBookEntry,
	GetAddressBookData,
	RemoveAddressBookEntry,
	OpenAddressBook,
	funtypes.Object({ method: funtypes.Literal('popup_personalSignReadyAndListening') }),
	funtypes.Object({ method: funtypes.Literal('popup_changeChainReadyAndListening') }),
	funtypes.Object({ method: funtypes.Literal('popup_interceptorAccessReadyAndListening') }),
	funtypes.Object({ method: funtypes.Literal('popup_confirmTransactionReadyAndListening') }),
	funtypes.Object({ method: funtypes.Literal('popup_requestNewHomeData') }),
)

export type MessageToPopupSimple = funtypes.Static<typeof MessageToPopupSimple>
export const MessageToPopupSimple = funtypes.Object({
	method: funtypes.Union(
		funtypes.Literal('popup_chain_update'),
		funtypes.Literal('popup_started_simulation_update'),
		funtypes.Literal('popup_simulation_state_changed'),
		funtypes.Literal('popup_confirm_transaction_simulation_started'),
		funtypes.Literal('popup_accounts_update'),
		funtypes.Literal('popup_websiteIconChanged'),
		funtypes.Literal('popup_addressBookEntriesChanged'),
		funtypes.Literal('popup_interceptor_access_changed'),
		funtypes.Literal('popup_notification_removed'),
		funtypes.Literal('popup_signer_name_changed'),
		funtypes.Literal('popup_websiteAccess_changed'),
		funtypes.Literal('popup_notification_added'),
	)
}).asReadonly()

export type PersonalSignRequest = funtypes.Static<typeof PersonalSignRequest>
export const PersonalSignRequest = funtypes.Object({
	method: funtypes.Literal('popup_personal_sign_request'),
	data: funtypes.Intersect(
		funtypes.Object({
			activeAddress: EthereumAddress,
			requestId: funtypes.Number,
			simulationMode: funtypes.Boolean,
			account: AddressBookEntry,
			method: funtypes.Union(
				funtypes.Literal('personal_sign'),
				funtypes.Literal('eth_signTypedData'),
				funtypes.Literal('eth_signTypedData_v1'),
				funtypes.Literal('eth_signTypedData_v2'),
				funtypes.Literal('eth_signTypedData_v3'),
				funtypes.Literal('eth_signTypedData_v4')
			),
		}),
		funtypes.Object({
			type: funtypes.Literal('NotParsed'),
			message: funtypes.String,
		}).Or(funtypes.Object({
			type: funtypes.Literal('Permit'),
			message: EIP2612Message,
			addressBookEntries: funtypes.Object({
				owner: AddressBookEntry,
				spender: AddressBookEntry,
				verifyingContract: AddressBookEntry,
			}),
		})).Or(funtypes.Object({
			type: funtypes.Literal('Permit2'),
			message: Permit2,
			addressBookEntries: funtypes.Object({
				token: AddressBookEntry,
				spender: AddressBookEntry,
				verifyingContract: AddressBookEntry,
			}),
		}))
	)
})

export type ChangeChainRequest = funtypes.Static<typeof ChangeChainRequest>
export const ChangeChainRequest = funtypes.Object({
	method: funtypes.Literal('popup_ChangeChainRequest'),
	data: funtypes.Object({
		requestId: funtypes.Number,
		simulationMode: funtypes.Boolean,
		chainId: EthereumQuantity,
		website: Website,
	})
})

export type InterceptorAccessDialog = funtypes.Static<typeof InterceptorAccessDialog>
export const InterceptorAccessDialog = funtypes.Object({
	method: funtypes.Literal('popup_interceptorAccessDialog'),
	data: funtypes.Object({
		website: Website,
		requestAccessToAddress: funtypes.Union(AddressInfoEntry, funtypes.Undefined),
		originalRequestAccessToAddress: funtypes.Union(AddressInfoEntry, funtypes.Undefined),
		associatedAddresses: funtypes.ReadonlyArray(AddressInfoEntry),
		addressInfos: funtypes.ReadonlyArray(AddressInfo),
		signerAccounts: funtypes.ReadonlyArray(EthereumAddress),
		signerName: SignerName,
		simulationMode: funtypes.Boolean,
		socket: WebsiteSocket,
	})
})

export type ConfirmTransactionSimulationStateChanged = funtypes.Static<typeof ConfirmTransactionSimulationStateChanged>
export const ConfirmTransactionSimulationStateChanged = funtypes.Object({
	method: funtypes.Literal('popup_confirm_transaction_simulation_state_changed'),
	data: funtypes.Object({
		requestId: funtypes.Number,
		transactionToSimulate: EthereumUnsignedTransaction,
		simulationMode: funtypes.Boolean,
		simulationState: SimulationState,
		visualizerResults: funtypes.ReadonlyArray(SimResults),
		addressBookEntries: AddressBookEntries,
		tokenPrices: funtypes.ReadonlyArray(TokenPriceEstimate),
		activeAddress: EthereumAddress,
		signerName: SignerName,
		website: Website,
	})
})

export type TabIconDetails = funtypes.Static<typeof TabIconDetails>
export const TabIconDetails = funtypes.Object({
	icon: funtypes.String,
	iconReason: funtypes.String,
})

export type WebsiteAddressAccess = funtypes.Static<typeof WebsiteAddressAccess>
export const WebsiteAddressAccess = funtypes.Object({
	address: EthereumAddress,
	access: funtypes.Boolean,
}).asReadonly()

export type LegacyWebsiteAccess = funtypes.Static<typeof WebsiteAccess>
export const LegacyWebsiteAccess = funtypes.Object({
	origin: funtypes.String,
	originIcon: funtypes.Union(funtypes.String, funtypes.Undefined),
	access: funtypes.Boolean,
	addressAccess: funtypes.Union(funtypes.ReadonlyArray(WebsiteAddressAccess), funtypes.Undefined),
})
export type LegacyWebsiteAccessArray = funtypes.Static<typeof LegacyWebsiteAccessArray>
export const LegacyWebsiteAccessArray = funtypes.ReadonlyArray(LegacyWebsiteAccess)

export type WebsiteAccess = funtypes.Static<typeof WebsiteAccess>
export const WebsiteAccess = funtypes.Object({
	website: Website,
	access: funtypes.Boolean,
	addressAccess: funtypes.Union(funtypes.ReadonlyArray(WebsiteAddressAccess), funtypes.Undefined),
}).asReadonly()

export type WebsiteAccessArray = funtypes.Static<typeof WebsiteAccessArray>
export const WebsiteAccessArray = funtypes.ReadonlyArray(WebsiteAccess)

export type WebsiteAccessArrayWithLegacy = funtypes.Static<typeof WebsiteAccessArrayWithLegacy>
export const WebsiteAccessArrayWithLegacy = funtypes.Union(LegacyWebsiteAccessArray, WebsiteAccessArray)

export type UserAddressBook = funtypes.Static<typeof UserAddressBook>
export const UserAddressBook = funtypes.Object({
	addressInfos: funtypes.ReadonlyArray(AddressInfo),
	contacts: ContactEntries,
})

export type PendingAccessRequest = funtypes.Static<typeof PendingAccessRequest>
export const PendingAccessRequest = funtypes.Object({
	socket: WebsiteSocket,
	request: funtypes.Union(InterceptedRequest, funtypes.Undefined),
	website: Website,
	requestAccessToAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
}).asReadonly()

export type PendingAccessRequestArray = funtypes.Static<typeof PendingAccessRequestArray>
export const PendingAccessRequestArray = funtypes.ReadonlyArray(PendingAccessRequest)

export interface PendingAccessRequestWithMetadata extends PendingAccessRequest {
	addressMetadata: [string, AddressInfoEntry][],
}

export type Settings = funtypes.Static<typeof Settings>
export const Settings = funtypes.Object({
	activeSimulationAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
	activeSigningAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
	activeChain: EthereumQuantity,
	page: Page,
	useSignersAddressAsActiveAddress: funtypes.Boolean,
	websiteAccess: WebsiteAccessArray,
	simulationMode: funtypes.Boolean,
	pendingAccessRequests: PendingAccessRequestArray,
	userAddressBook: UserAddressBook,
})

export type UpdateHomePage = funtypes.Static<typeof UpdateHomePage>
export const UpdateHomePage = funtypes.ReadonlyObject({
	method: funtypes.Literal('popup_UpdateHomePage'),
	data: funtypes.ReadonlyObject({
		simulation: funtypes.ReadonlyObject({
			simulationState: funtypes.Union(SimulationState, funtypes.Undefined),
			visualizerResults: funtypes.Union(funtypes.ReadonlyArray(SimResults), funtypes.Undefined),
			addressBookEntries: AddressBookEntries,
			tokenPrices: funtypes.ReadonlyArray(TokenPriceEstimate),
			activeAddress: funtypes.Union(EthereumAddress, funtypes.Undefined),
		}),
		websiteAccessAddressMetadata: funtypes.ReadonlyArray(AddressInfoEntry),
		pendingAccessMetadata: funtypes.ReadonlyArray(funtypes.Tuple(funtypes.String, AddressInfoEntry)),
		signerAccounts: funtypes.Union(funtypes.ReadonlyArray(EthereumAddress), funtypes.Undefined),
		signerChain: funtypes.Union(EthereumQuantity, funtypes.Undefined),
		signerName: SignerName,
		currentBlockNumber: funtypes.Union(EthereumQuantity, funtypes.Undefined),
		settings: Settings,
		tabIconDetails: funtypes.Union(TabIconDetails, funtypes.Undefined),
		makeMeRich: funtypes.Boolean,
	})
})

export type MessageToPopup = funtypes.Static<typeof MessageToPopup>
export const MessageToPopup = funtypes.Union(
	MessageToPopupSimple,
	GetAddressBookDataReply,
	PersonalSignRequest,
	ChangeChainRequest,
	InterceptorAccessDialog,
	ConfirmTransactionSimulationStateChanged,
	NewBlockArrived,
	UpdateHomePage,
)

export type ExternalPopupMessage = funtypes.Static<typeof MessageToPopup>
export const ExternalPopupMessage = funtypes.Union(MessageToPopup, PopupMessage) // message that moves from popup to another, or from background page to popup, or from popup to background page

export type HandleSimulationModeReturnValue = {
	result: unknown,
} | {
	error: {
		code: number,
		message: string,
	}
} | {
	forward: true,
}

export type AddressBookTabIdSetting = funtypes.Static<typeof AddressBookTabIdSetting>
export const AddressBookTabIdSetting = funtypes.Object({
	addressbookTabId: funtypes.Number,
}).asReadonly()

export type WindowMessageSignerAccountsChanged = funtypes.Static<typeof WindowMessageSignerAccountsChanged>
export const WindowMessageSignerAccountsChanged = funtypes.Object({
	method: funtypes.Literal('window_signer_accounts_changed'),
	data: funtypes.Object({
		socket: WebsiteSocket,
	})
})

export type WindowMessage = funtypes.Static<typeof WindowMessage>
export const WindowMessage = WindowMessageSignerAccountsChanged

export type PendingUserRequestPromise = funtypes.Static<typeof PendingUserRequestPromise>
export const PendingUserRequestPromise = funtypes.Object({
	website: Website,
	dialogId: funtypes.Number,
	socket: WebsiteSocket,
	request: InterceptedRequest,
	transactionToSimulate: EthereumUnsignedTransaction,
	simulationMode: funtypes.Boolean,
})

export type PendingChainChangeConfirmationPromise = funtypes.Static<typeof PendingChainChangeConfirmationPromise>
export const PendingChainChangeConfirmationPromise = funtypes.Object({
	website: Website,
	dialogId: funtypes.Number,
	socket: WebsiteSocket,
	request: InterceptedRequest,
	simulationMode: funtypes.Boolean,
})

export type PendingPersonalSignPromise = funtypes.Static<typeof PendingPersonalSignPromise>
export const PendingPersonalSignPromise = funtypes.Object({
	website: Website,
	dialogId: funtypes.Number,
	socket: WebsiteSocket,
	request: InterceptedRequest,
	simulationMode: funtypes.Boolean,
	params: funtypes.Union(PersonalSignParams, SignTypedDataParams)
})

export type PendingInterceptorAccessRequestPromise = funtypes.Static<typeof PendingInterceptorAccessRequestPromise>
export const PendingInterceptorAccessRequestPromise = funtypes.Object({
	website: Website,
	dialogId: funtypes.Number,
	socket: WebsiteSocket,
	request: funtypes.Union(InterceptedRequest, funtypes.Undefined),
	requestAccessToAddress: funtypes.Union(AddressInfoEntry, funtypes.Undefined),
})

export type TabState = funtypes.Static<typeof TabState>
export const TabState = funtypes.Object({
	signerName: SignerName,
	signerAccounts: funtypes.ReadonlyArray(EthereumAddress),
	signerChain: funtypes.Union(EthereumQuantity, funtypes.Undefined),
	tabIconDetails: TabIconDetails,
})
