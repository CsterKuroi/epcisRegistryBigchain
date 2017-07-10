var BigchainDB  = require( 'bigchaindb-driver')
var parseString = require('xml2js').parseString;
var config = require('../../config.json');


const API_PATH =  config.bigchaindb.server

const alice = new BigchainDB.Ed25519Keypair()

var allEpcidPromises = []

//todo: change the way to search an asset id
//currently this is doing a text-search in mongo, 
//this is not so exact, since we have the exact id

var getAsset = function (epcid) {
	let conn = new BigchainDB.Connection(API_PATH)

	return new Promise( (resolve, reject) => {
		console.log("  getEpcisAsset: " + epcid)
		conn.searchAssets(epcid)
			.then( (res) => { 
				if (res.length >=1) {
					resolve(res[0].data)
				} else {
					resolve(res)
				}
			} )
	})

}

var getEpcisAsset = function (epcid) {
	let conn = new BigchainDB.Connection(API_PATH)

	return new Promise( (resolve, reject) => {
		console.log("  getEpcisAsset: " + epcid)
		conn.searchAssets(epcid)
			.then( (res) => { resolve(res)} )
	})

}

var getTransaction = function (txid) {
	let conn = new BigchainDB.Connection(API_PATH)

	return new Promise( (resolve, reject) => {
		//console.log("  getTransaction: " + txid)
		conn.getTransaction(txid)
			.then( (res) => { resolve(res)} )
	})

}

var getLastTransaction = function (assetid) {
	let conn = new BigchainDB.Connection(API_PATH)

	return new Promise( (resolve, reject) => {
		console.log("  getTransactions: " + assetid)
		conn.listTransactions(assetid)
			.then( (res) => { 
				if (typeof(res)=="object" && res.length >0) {
					last = res[res.length -1]
				}
				resolve(last)
			} )
	})

}

var postEpcisAsset = function(epcisAsset) {
	// Construct a transaction payload 
	const tx = BigchainDB.Transaction.makeCreateTransaction(
	    epcisAsset, //asset 
    	epcisAsset, //metadata
    	[ BigchainDB.Transaction.makeOutput(
            BigchainDB.Transaction.makeEd25519Condition(alice.publicKey))
    	],
    	alice.publicKey
	)
 
	// Sign the transaction with private keys 
	const txSigned = BigchainDB.Transaction.signTransaction(tx, alice.privateKey)
	//console.log(txSigned)

	// Send the transaction off to BigchainDB 
	var conn = new BigchainDB.Connection(API_PATH)

	console.log(txSigned.id)
	return conn.postTransaction(txSigned)
    	.then(() => conn.pollStatusAndFetchTransaction(txSigned.id))
	    .then(res => {
    	    console.log(res)
        	//console.log(API_PATH + 'transactions/' + txSigned.id )
	        console.log('Transaction', txSigned.id, 'accepted')
    	})
}

var updateEpcisAsset = function(epcisAsset, dbAsset, txAsset) {

	const tx = BigchainDB.Transaction.makeTransferTransaction(
	    txAsset,
	    epcisAsset,
    	[ BigchainDB.Transaction.makeOutput(
            BigchainDB.Transaction.makeEd25519Condition(alice.publicKey), "1")
    	],
	    0
	)
	// Sign the transaction with private keys 
	const txSigned = BigchainDB.Transaction.signTransaction(tx, alice.privateKey)

	// Send the transaction off to BigchainDB 
	let conn = new BigchainDB.Connection(API_PATH)

	return conn.postTransaction(txSigned)
    	.then(() => conn.pollStatusAndFetchTransaction(txSigned.id))
	    .then(res => {
	        console.log('Transaction', txSigned.id, 'accepted (update)')
    	})
}

//check if the assets already exists in the bigchainDB
//if already exists => update the new asset in the metadada
//if not exist => the metada and the asset-data are the same

var updateObjectEvent = function(asset) {
	//check if the epcis asset already exists
	return new Promise( (resolve, reject) => {
		getEpcisAsset(asset.epcid).then(
			(dbAsset) => {
				//console.log(dbAsset)
				if (typeof(dbAsset) == "object" && dbAsset.length == 0 ) {
					postEpcisAsset(asset)	
						.then(()=> {resolve(true)} )
				} else {
					//console.log("  the asset already exists")
					//getTransaction(dbAsset[0].id)
					getLastTransaction(dbAsset[0].id)
						.then( (tx) => {
							updateEpcisAsset(asset, dbAsset, tx)
								.then(()=> {resolve(true)} )
						})
				}
			}
		)
	})
}

var processObjectEvent = function (object) {
	if (typeof(object.epcList[0]['epc']) == "undefined") {
		return new Promise( (resolve,reject) => {
			resolve(true)
		})
	}

    var epcidPromises = []

	for (epcid of object.epcList[0].epc ) {
		var sanitizedEpcis = epcid.replace(/:/g, '_').replace(/\./g, '_');
		var asset = { 
			epcid: sanitizedEpcis
		}

		if (typeof(object.eventTime) != "undefined") {
			asset.eventTime= object.eventTime[0]
		}

		if (typeof(object.recordTime) != "undefined") {
			asset.recordTime= object.recordTime[0]
		}

		if (typeof(object.eventTimeZoneOffset) != "undefined") {
			asset.eventTimeZoneOffset= object.eventTimeZoneOffset[0]
		}

		if (typeof(object.baseExtension[0].eventId) != "undefined") {
			asset.eventId= object.baseExtension[0].eventId[0]
		}

		if (typeof(object.action) != "undefined") {
			asset.action= object.action[0]
		}

		if (typeof(object.bizStep) != "undefined") {
			asset.bizStep= object.bizStep[0]
		}

			//disposition: object.disposition[0],
			//readPoint: object.readPoint[0],
			//bizLocation: object.bizLocation[0]

		//wait until all promises are completed	
		//epcidPromises.push(updateObjectEvent(asset))
		allEpcidPromises.push(updateObjectEvent(asset))
	}     	

	console.log(allEpcidPromises.length)

	if (allEpcidPromises.length < 50) {
		return Promise.resolve()
	}

	return new Promise( (resolve,reject) => {
		console.log("wait for all pending promises")
		console.log(allEpcidPromises.length)
		var allPromises = Promise.all(allEpcidPromises)
		
		allPromises.then( function(res) {
			//console.log("after  - wait for all promises")
			allEpcidPromises = []
			console.log(allEpcidPromises.length)
 			resolve()
 		})
	})
}

var processLine = function(line) {
	return new Promise( (resolve, reject) => {
		parseString(line, function (err, result) {
			if (result["ObjectEvent"]) {
				processObjectEvent(result["ObjectEvent"])
					.then(resolve)
			} else {
				resolve(false)
			}
		})
	});
}

var postAsset = function(channel, assetData) {
	if (typeof name == "undefined" || channel=="") {
		reject("channel channel could not be empty string")
		return
	}

    var cryptoService = require("./cryptoService");
    var alice = null

	var nacl = require("tweetnacl")
	nacl.util = require('tweetnacl-util')
	var bs58 = require('bs58');
	var stringify = require('json-stable-stringify');

	var aKey = nacl.box.keyPair()
	var bKey = nacl.box.keyPair()
	var message = nacl.util.decodeUTF8( stringify(assetData) )
	var nonce   = nacl.util.decodeUTF8("123456781234567812345678")
	var theirPublicKey = bKey.publicKey
	var mySecretKey = aKey.secretKey

	var encrypted = bs58.encode(nacl.box(message, nonce, theirPublicKey, mySecretKey))
	//console.log(encrypted)

	var encryptedAsset = {
		channel: channel,
		//id: assetData.id,
		encrypted: encrypted
	}

    alice = cryptoService.getKeyPair()

	// Construct a transaction payload 
	const tx = BigchainDB.Transaction.makeCreateTransaction(
	    encryptedAsset, //asset 
    	assetData, //metadata
    	[ BigchainDB.Transaction.makeOutput(
            BigchainDB.Transaction.makeEd25519Condition(alice.publicKey))
    	],
    	alice.publicKey
	)
	// Sign the transaction with private keys 
	const txSigned = BigchainDB.Transaction.signTransaction(tx, alice.secretKey)
	console.log(txSigned)

	// Send the transaction off to BigchainDB 
	let conn = new BigchainDB.Connection(API_PATH)

	return new Promise( (resolve, reject) => {
		conn.postTransaction(txSigned)
    	//.then(() => conn.pollStatusAndFetchTransaction(txSigned.id))
	    .then((res) => {
    	    //console.log(res)
        	//console.log(API_PATH + 'transactions/' + txSigned.id )
	        console.log('Transaction', txSigned.id, 'sent')
	        resolve(txSigned.asset)
    	})
	})

}

module.exports.getAsset           = getAsset
module.exports.getEpcisAsset      = getEpcisAsset
module.exports.processObjectEvent = processObjectEvent
module.exports.postEpcisAsset     = postEpcisAsset
module.exports.postAsset          = postAsset
module.exports.processLine        = processLine
module.exports.getTransaction     = getTransaction





