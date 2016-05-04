[![Akera Logo](http://akera.io/logo.png)](http://akera.io/)

  Push notification module for Akera.io web service based on socket.io.
  Messages can be broadcasted due to incoming messages from clients or from
  back-end business logic periodically executed - 'long pool'. 

## Installation

```bash
$ npm install akera-push-notification
```

## Docs

  * [Website and Documentation](http://akera.io/)

## Quick Start

  This module can be loaded either as application or broker level service which 
  is usually done by adding a reference to it in corresponding `services` section 
  in `akera-web.json` configuration file - either globally if mounted at application 
  level or on each broker's configuration section.
   
```json
  "brokers": [
  	{	"name": "demo",
  		"host": "localhost",
		"port": 3737,
		"services": [
			{ 
				"middleware": "akera-push-notification",
				"config": {
					"channels": [
						{
							"name": "event",
							"requireAuthentication": true,
							"pollingInterval": 20000,
						 	"run4gl": {
						 		"messageApi": "api/push.p",
						 		"messageBroadcast": true,
						 		"messageChannel": "eventResponse", 
						 		"pollingApi": "api/pushPoll.p",
						 		"pollingChannel": "eventPolling"
						 	}
						 }
					]
				}
			}
		]
	}
  ]
```
  
  Service options available:
	- `channels`: the socket.io notification channels collection (array).
  
  For each notification channel the `name` property is mandatory and must be unique on each namespace.
	- `name`: the notification channel name
	- `requireAuthentication`: the notification channel require authentication, if set to true only authenticated clients are subscribed to it
	- `pollingInterval`: the long polling interval (milliseconds), used in conjunction with `polllingApi` to periodically make a back-end call that might push back notification on this channel
	- `run4gl`: options for the back-end akera.io business logic API
		- `messageApi`: the API procedure that will be executed when a message is received on this channel
		- `messageBroadcast`: broadcast flag, if true the incoming message will be broadcasted to all listening clients  
		- `messageChannel`: the channel name where the return of message API procedure is to be sent, defaults to channel name
		- `pollingApi`: the API procedure that will be executed by the long polling mechanism - if `pollingInterval` value is set
		- `pollingChannel`: the channel name where the return of long polling API procedure is to be sent, defaults to channel name
		
  All API procedures - message handlers and long polling - must have the following signature:
  	- [in] [`character`] `name`: the notification channel name
  	- [in] [`longchar`] `message data`: the notification message data (if any)
  	- [out] [`character`] `response name`: the notification channel name where the response is to be sent, defaults to `pollingChannel` for long polling and to `messageChannel` for message handler API
  	- [out] [`logical`] `broadcast`: broadcast flag, if set to true the response message will be broadcasted to all listeners, otherwise only the message originator gets it - long polling responses are always broadcasted
  	- [out] [`longchar`] `response data`: the response message, if not set nothing is sent back or broadcasted

```
	/* Push notification handler */
	define input  parameter channelName    		as character.
	define input  parameter messageData  		as longchar.
	define output parameter responseChannel		as character.
	define output parameter broadcastResponse    as logical.
	define output parameter responseData 		as longchar.


	if messageData > '' then
   		responseData = 'echo> ' + messageData.
	else
   		responseData = 'time> ' + string(now).

	/* randomly broadcast the message
	   ignored for long polling - always broadcast those 
	*/ 
	
	broadcastResponse = random(1, 100) mod 2 eq 0.
```	

  If used directly with Express.js application (or StrongLoop) the configuration object
  passed in must also contain akera.io broker information so back-end business logic can be executed.
  
```javascript

	var SocketIo = require('socket.io');
    app.io = new SocketIo(socket);

    var AkeraPush = require('akera-push-notification');

    new AkeraPush(app /* express.js app */, 
    		{
			"broker": {
				"host": "localhost",
				"port": 7300
			}, 
			"channels": [
				{
					"name": "event",
					"requireAuthentication": true,
					...
				 }
			]
		} /* push notification configuration */, 
		true /* flag set to true for express.js app */);
      
```
  
## License
	
MIT 
