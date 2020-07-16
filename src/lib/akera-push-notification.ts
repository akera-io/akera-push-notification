import {  Namespace, Socket } from "socket.io";
import { WebMiddleware } from "@akeraio/web-middleware";
import {} from "@akeraio/web-session";
import { Router } from "express";
import { ConnectionPoolOptions, ConnectionPool, LogLevel } from "@akeraio/api";
import * as akeraApi from "@akeraio/api";



export interface mainConfig {
  channels?: ChannelConfig;
  requireAuthentication?:true;
  route?:string;
}

/**
 * Notification channels collection (array)
 */
export interface ChannelConfig {
  /**
   * The notification channel name,  the `name` property is mandatory and must be unique
   */
  name?: string;
  /**
   *  The notification channel require authentication, if set to true only authenticated clients are subscribed to it
   */
  requireAuthentication?: true;
  /**
   * Conjunction with `polllingApi` to periodically make a back-end call
   */
  pollingInterval?: 20000;
  /**
   * Time for polling
   */
  _pollingTimer?: any;

  /**
   * Options for the back-end akera.io
   */
  run4gl: {
    /**
     *  The procedure will be executed when a message is received on this channel
     */
    messageApi?: "api/push.p";
    /**
     * Broadcast flag
     */
    messageBroadcast?: boolean;
    /**
     * The channel name where the return of message
     */
    messageChannel?: string;
    /**
     * The API procedure that will be executed by the long polling mechanism
     */
    pollingApi?: "api/pushPoll.p";
    /**
     * The channel name where the return of long polling API procedure is to be sent
     */
    pollingChannel?: Event | string;
  };
  broadcast?: boolean;
  forEach: any;
}

export class AkeraPush extends WebMiddleware {
  private withExpress = false;
  private _router: Router;
  private _config: mainConfig;
  private io: Namespace;
  private _connectionPool: ConnectionPool;
  

  public constructor(config: mainConfig) {
    super();
    this._config = config;
  }

  public mount(config: ConnectionPoolOptions | ConnectionPool): Router {
    if (this._router) {
      return this._router;
    }
    this._router = Router({
      mergeParams: true,
    });
  }

  public initPush(config: mainConfig) {
    

    if (!this.io || !this.io.sockets) {
      throw new Error(
        "socket.io handle not set, enable this in akera-web/express first."
      );
    }
    // default namespace if mounted as application middleware
    let nspName = "/";
    let nsp: Namespace = this.io;

    config = config || null;
    this._config = config;
   

    // add validation middleware if authentication required
    if (config.requireAuthentication) {
      nsp.use(function (socket, next) {
        if (this.requireAuthentication(socket.request)) {
          return next();
        }

        this.log(
          LogLevel.error,
          `Socket.io unauthenticated connection on   ${nspName}`
        );
        next(new Error("Authentication required."));
      });
    }

    nsp.on("connection", this.onConnect);

    this.io = nsp;
    this._config = config;

    console.log(this._config);
  }

  private requireAuthentication(req: Express.Request): boolean {
    return req && req.session && (req.session.user || req.session.get("user"));
  }

  private log(level: any, msg: string) {
    if (akeraApi) {
      akeraApi.LogLevel;
    } else {
      console.log(level, msg);
    }
  }

  public onConnect(socket: Socket) {
    if (this._config.channels) {
      const isAuthenticated = this.requireAuthentication(socket.request);

      this._config.channels.forEach(function (channel: ChannelConfig) {
        // enable message handlers for public channels or if authenticated
        if (isAuthenticated || !channel.requireAuthentication) {
          socket.on(channel.name, function (data: string){
            this.handleMessage(channel, data, socket);
          });
        } else {
          this.log(
            LogLevel.debug,
            `Skipping unauthenticated for non public channel: 
              ${this.getChannelRoute(channel.name)}`
          );
        }

        // set timers for long polling channels
        if (!channel._pollingTimer && channel.pollingInterval > 0) {
          this.log(
            LogLevel.debug,
            `Set long polling trigger on: 
              ${this.getChannelRoute(channel.name)}
               for  
              ${channel.pollingInterval}`
          );
          channel._pollingTimer = setInterval(function () {
            if (channel.run4gl && channel.run4gl.pollingApi) {
              channel.run4gl.pollingChannel =
                channel.run4gl.pollingChannel || channel.name;
              this.log(
                LogLevel.debug,
                `Fire long polling 4gl trigger on: 
                  ${this.getChannelRoute(channel.name)} 
                   -  
                  ${channel.run4gl.pollingApi}`
              );
              // always broadcast long pool messages, there is no originator in
              // this case
              this.run4gl(
                channel.run4gl.pollingApi,
                channel.name,
                null,
                channel.run4gl.pollingChannel,
                true
              );
            }
          }, channel.pollingInterval);
        }
      });

      socket.on("disconnect", this.onDisconnect);
    }
  }

  public onDisconnect() {
    // do nothing if we still have clients
    for (const id in this.io.connected) {
      return id;
    }

    // disable timers for long polling channels
    this._config.channels.forEach(function (channel: ChannelConfig) {
      if (channel._pollingTimer) {
        clearInterval(channel._pollingTimer);
        delete channel._pollingTimer;
      }
    });

    this.log(
      LogLevel.verbose,
      `All socket.io connections closed on: ${this._config.route}`
    );
  }

  public getChannelRoute(channel: ChannelConfig) {
    if (this._config.route == "/") {
      return "/" + channel;
    }

    return `${this._config.route} / ${channel}`;
  }

  public handleMessage(channel: ChannelConfig, data: string, socket: Socket) {
    if (channel) {
      this.log(
        LogLevel.debug,
        `Message received on: ${this.getChannelRoute(channel)}`
      );

      // broadcast channel, let everyone else know about it
      if (channel.broadcast === true) {
        this.broadcast(channel.name, data, socket);
      }

      // 4gl business logic
      if (channel.run4gl && channel.run4gl.messageApi) {
        channel.run4gl.messageChannel =
          channel.run4gl.messageChannel || channel.name;
        channel.run4gl.messageBroadcast =
          channel.run4gl.messageBroadcast || channel.broadcast;
        this.run4gl(
          channel.run4gl.messageApi,
          channel,
          data,
          channel.run4gl.messageChannel,
          channel.run4gl.messageBroadcast,
          socket
        );
      }
    }
  }

  public run4gl(
    procedure: string,
    event: ChannelConfig,
    data: string,
    responseChannel: string,
    broadcast: boolean,
    socket: Socket
  ) {
    if (procedure && event) {
      if (!akeraApi) {
        return this.log(
          LogLevel.error,
          "akera.io API module is not available, please install that using npm install first."
        );
      }
      

      const broker =
        this._connectionPool.brokers ||
        (socket && socket.request && socket.request.broker) 
        

      if (!broker) {
        return this.log(
          LogLevel.error,
          `No akera.io broker configuration set, unable to make 4gl api call for:
           ${this.getChannelRoute(event)}`
        );
      }

      const p = akeraApi.Parameter;
      const q=akeraApi.DataType;
      let apiConn = null;
      

      akeraApi
        .connect(broker)
        .then(function (conn){
          apiConn = conn;
          // call 4gl procedure, need to have this predefined signature
          // - in, event name (character)
          // - in, event data (longchar)
          // - out, event name (character)
          // - out, broadcast flag (logical)
          // - out, output message (longchar)
          this.log(
            LogLevel.debug,
            ` Run 4gl trigger on:  ${this.getChannelRoute(event)} -  ${data}`
          );

          return conn.call
            .apply(procedure)
            .parameters(
              p.input(event, q.CHARACTER),
              p.input(data ? JSON.stringify(data) : null, q.LONGCHAR),
              p.output(q.CHARACTER),
              p.output(q.LOGICAL),
              p.output(q.LONGCHAR)
            )
            .run();
        })
        .then(function (response) {
          let event4gl = response.parameters[0]
            ? response.parameters[0].trim()
            : null;
          broadcast = response.parameters[1] || broadcast;
          let data4gl = response.parameters[2]
            ? response.parameters[2].trim()
            : null;

          this.log(
            LogLevel.debug,
            `Callback from 4gl trigger on: 
              ${this.getChannelRoute(event)} 
               - 
              ${data4gl}`
          );

          // only send response back if we get some data
          if (data4gl && data4gl.length > 0) {
            try {
              data4gl = JSON.parse(data4gl);
            } catch (err) {
              err.message;
            }

            // initial channel/event used as default if not updated by the
            // server
            if (!event4gl || event4gl.length === 0) {
              event4gl = responseChannel || event;
            }
      

            // if broadcast send to everyone, including the originator
            if (this.broadcast === true) {
              this.log(
                "debug",
                `Broadcast from 4gl trigger on: 
                  ${this.getChannelRoute(responseChannel)} 
                   - 
                  ${data4gl}`
              );
              return this.broadcast(responseChannel, data4gl);
            }
            // if not to be broadcasted send it to the originator only
            if (socket) {
              this.log(
                LogLevel.debug,
                `Responding from 4gl trigger on:
                  ${this.getChannelRoute(responseChannel)} 
                  - 
                  ${data4gl}`
              );
              socket.emit(responseChannel, data4gl);
            }
          }
        });
        socket.on('error', (error)=>{
        if (socket) {
          socket.emit(error, {
            error:error.message,
          });
        }

        this.log(LogLevel.error, error.message);
      });
      socket.on('disconnect', () => {
        apiConn;
      });
    }
  }
  

  public broadcast(event: string, data: string, socket: Socket) {
    if (event) {
      if (!socket) {
        this.io.emit(event, data);
      } else {
        // broadcast the event to all but the originator
        for (const id in this.io.connected) {
          const conn = this.io.connected[id];

          if (conn !== socket) {
            conn.emit(event, data);
          }
        }
      }
    }
  }
}
