import { Server, Namespace, Socket } from "socket.io";
import { WebMiddleware } from "@akeraio/web-middleware";
import {} from "@akeraio/web-session";
import { Router } from "express";
import { ConnectionPoolOptions, ConnectionPool, LogLevel } from "@akeraio/api";

export interface ApiOption extends ConnectionPool {
  call: any;
  connect: any;
}

export interface mainConfig {
  channels?: any;
  route?: string;
  __broker?: string;
}

export class AkeraPush extends WebMiddleware {
  private withExpress = false;
  private _router: Router;
  private _config: mainConfig;
  private akeraApi: ApiOption;
  private akeraApp: any;
  private io: any;
  private broker: string;

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

  public initPush(config, router) {
    this.akeraApp = this.withExpress == true ? null : router.__app;
    const io: Server =
      this.withExpress == true
        ? router.io
        : this.akeraApp.app && this.akeraApp.app.io;

    if (!io || !io.sockets) {
      throw new Error(
        "socket.io handle not set, enable this in akera-web/express first."
      );
    }
    // default namespace if mounted as application middleware
    let nspName = "/";
    let nsp: Namespace = io.sockets;

    config = config || {};
    config.route = nspName;
    this._config = config;

    // if mounted as broker level create a 'namespace' for it
    if (router._broker) {
      nspName += router._broker.alias || router._broker.name;
      nsp = io.of(nspName);
      router._broker.io = nsp;

      this.broker = router._broker;
    }

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
    if (this.akeraApp) {
      this.akeraApp.log(level, msg);
    } else {
      console.log(level, msg);
    }
  }

  public onConnect(socket: Socket): void {
    if (this._config.channels) {
      const isAuthenticated = this.requireAuthentication(socket.request);

      this._config.channels.forEach(function (channel) {
        // enable message handlers for public channels or if authenticated
        if (isAuthenticated || !channel.requireAuthentication) {
          socket.on(channel.name, function (data): void {
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
          channel._pollingTimer = setInterval(function (): void {
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
    this._config.channels.forEach(function (channel) {
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

  private getChannelRoute(channel: string) {
    if (this._config.route == "/") {
      return "/" + channel;
    }

    return `${this._config.route} / ${channel}`;
  }

  public handleMessage(channel, data, socket) {
    if (channel) {
      this.log(
        LogLevel.debug,
        `Message received on: ${this.getChannelRoute(channel.name)}`
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
          channel.name,
          data,
          channel.run4gl.messageChannel,
          channel.run4gl.messageBroadcast,
          socket
        );
      }
    }
  }

  public run4gl(procedure, event, data, responseChannel, broadcast, socket) {
    if (procedure && event) {
      if (!this.akeraApi) {
        return this.log(
          LogLevel.error,
          "akera.io API module is not available, please install that using npm install first."
        );
      }

      const broker =
        this.broker ||
        (socket && socket.request && socket.request.broker) ||
        this._config.__broker;

      if (!broker) {
        return this.log(
          LogLevel.error,
          `No akera.io broker configuration set, unable to make 4gl api call for:
           ${this.getChannelRoute(event)}`
        );
      }

      const p = this.akeraApi.call.parameter;
      let apiConn = null;

      this.akeraApi
        .connect(broker)
        .then(function (conn) {
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
            .procedure(procedure)
            .parameters(
              p.input(event, p.data_type.character),
              p.input(data ? JSON.stringify(data) : null, p.data_type.longchar),
              p.output(p.data_type.character),
              p.output(p.data_type.logical),
              p.output(p.data_type.longchar)
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
            if (broadcast === true) {
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
      socket.catch(function (err) {
        if (socket) {
          socket.emit(event, {
            error: err.message,
          });
        }

        this.log(LogLevel.error, err.message);
      });
      socket.finally(function () {
        if (apiConn) {
          apiConn.disconnect();
        }
      });
    }
  }

  private broadcast(event, data, socket): void {
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
