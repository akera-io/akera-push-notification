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
					"requireAuthentication": true,
					""
				}
			}
		]
	}
  ]
```
  
  Service options available:
	- `route`: the route where the service is going to be mounted (default: '/rest/api/')
  
  The interface can then be used to call business logic procedures on the broker by making HTTP `POST` requests to `http://[host]/[broker]/rest-api/` and send call information using the `call` request parameter as a JSON object with following structure:

	- `procedure`: the business logic procedure name
	- `parameters`: array of optional procedure parameters, must match the procedure parameters else an error will be thrown back. Each parameter entry has the following structure:
		- `dataType`: parameter data type, defaults to `character`
		- `type`: parameter type/direction, valid values: `input`, `output`, `inout`, defaults to `input`
		- `value`: parameter value for input/input-output parameters
	
```json
	call = {
		"procedure": "crm/getCustomerBalance.p",
		"parameters": [
			{
				"dataType": "integer",
				"value": 12
			},
			{
				"type": "output",
				"dataType": "decimal"
			},
			{
				"type": "output",
				"dataType": "decimal"
			}
		]
	}
```
  
  The response is a JSON object with either a `parameters` array or an `error` object, only output and input-output parameters are sent back in the `parameters` array keeping the same order as in the input parameters array. 
## License
	
MIT 
