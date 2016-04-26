module.exports = AkeraPush;

function AkeraPush(akeraWebApp, mainConfig) {
  var self = this;

  this.init = function(config, router) {

    if (!router || !router.__app || typeof router.__app.require !== 'function') {
      throw new Error('Invalid Akera web service router.');
    }

    var akeraApp = router.__app;
    var io = akeraApp.app && akeraApp.app.io;

    if (!io) {
      throw new Error(
          'socket.io handle not set, enable this in akera-web first.');
    }

    // default namespace if mounted as application middleware
    var nspName = '/';
    var nsp = io.sockets;

    config = config || {};
    config.route = nspName;

    // api module is required to call 4gl business logic directly
    self.akeraApi = akeraApp.require('akera-api');

    // if mounted as broker level create a 'namespace' for it
    if (router.__broker) {
      nspName += router.__broker.alias || router.__broker.name;
      nsp = io.of(nspName);
      router.__broker.io = nsp;

      self.broker = router.__broker;
    }

    // add validation middleware if authentication required
    if (config.requireAuthentication) {
      nsp.use(function(socket, next) {
        if (self.requireAuthentication(socket.request))
          return next();

        self.log('error', 'Socket.io unauthorized connection on ' + nspName);
        next(new Error('Authentication required.'));
      });
    }

    nsp.on('connection', self.onConnect);

    self.io = nsp;
    self.config = config;
    self.akeraApp = akeraApp;
  };

  this.requireAuthentication = function(req) {
    return req && req.session && req.session.get('user');
  };

  this.log = function(level, msg) {
    self.akeraApp.log(level, msg);
  };

  this.onConnect = function(socket) {

    if (self.config.channels) {
      var isAuthenticated = self.requireAuthentication(socket.request);

      self.config.channels.forEach(function(channel) {
        // enable message handlers for public channels or if authenticated
        if (isAuthenticated || channel['public'] === true) {
          socket.on(channel.name, function(data) {
            self.handleMessage(channel, data, socket);
          });
        }

        // set timers for long-pool channels
        if (!channel._poolTimer && channel.longPoolInterval > 0) {
          self.log('debug', 'Set long-pool trigger on: ' + self.config.route
              + '/' + channel.name + ' for ' + channel.longPoolInterval);
          channel._poolTimer = setInterval(function() {
            if (channel.run4gl && channel.run4gl.longPool) {
              channel.run4gl.longPoolResponse = channel.run4gl.longPoolResponse
                  || channel.name;
              self.log('debug', 'Fire long-pool 4gl trigger on: '
                  + self.config.route + '/' + channel.name + ' - '
                  + channel.run4gl.longPool);
              // always broadcast long pool messages, there is no originator in
              // this case
              self.run4gl(channel.run4gl.longPool, channel.name, null,
                  channel.run4gl.longPoolResponse, true);
            }
          }, channel.longPoolInterval);
        }
      });

      socket.on('disconnect', self.onDisconnect);
    }
  };

  this.onDisconnect = function() {

    // do nothing if we still have clients
    for ( var id in self.io.connected) {
      return;
    }

    // disable timers for long-pool channels
    self.config.channels.forEach(function(channel) {
      if (channel._poolTimer) {
        clearInterval(channel._poolTimer);
        delete channel._poolTimer;
      }
    });

    self.log('verbose', 'All socket.io connections closed on: '
        + self.config.route);

  };

  this.handleMessage = function(channel, data, socket) {

    if (channel) {
      self.log('debug', 'Message received on: ' + self.config.route + '/'
          + channel.name);

      // broadcast channel, let everyone else know about it
      if (channel.broadcast === true)
        self.broadcast(channel.name, data, socket);

      // 4gl business logic
      if (channel.run4gl && channel.run4gl.onMessage) {
        channel.run4gl.onMessageResponse = channel.run4gl.onMessageResponse
            || channel.name;
        channel.run4gl.onMessageBroadcast = channel.run4gl.onMessageBroadcast
            || channel.broadcast;
        self.run4gl(channel.run4gl.onMessage, channel.name, data,
            channel.run4gl.onMessageResponse,
            channel.run4gl.onMessageBroadcast, socket);
      }

    }
  };

  this.run4gl = function(procedure, event, data, responseChannel, broadcast,
      socket) {

    if (procedure && event) {
      if (!self.akeraApi)
        return self
            .log(
                'error',
                'akera.io API module is not available, please install that using npm install first.');

      var broker = self.broker || socket.request.broker;

      if (!broker)
        return self.log('error',
            'No akera.io broker configuration set, unable to make 4gl api call for: '
                + event);

      var p = self.akeraApi.call.parameter;
      var apiConn = null;

      self.akeraApi.connect(self.broker).then(
          function(conn) {
            apiConn = conn;
            // call 4gl procedure, need to have this predefined signature
            // - in, event name (character)
            // - in, event data (longchar)
            // - out, event name (character)
            // - out, broadcast flag (logical)
            // - out, output message (longchar)
            return conn.call.procedure(procedure).parameters(
                p.input(event, p.data_type.character),
                p.input(data ? JSON.stringify(data) : null,
                    p.data_type.longchar), p.output(p.data_type.character),
                p.output(p.data_type.logical), p.output(p.data_type.longchar))
                .run();
          }).then(
          function(response) {
            var event4gl = response.parameters[0] ? response.parameters[0]
                .trim() : null;
            broadcast = response.parameters[1] || broadcast;
            var data4gl = response.parameters[2] ? response.parameters[2]
                .trim() : null;

            self.log('verbose', 'Callback from 4gl trigger on: '
                + self.config.route + '/' + event + ' - ' + data4gl);

            // only send response back if we get some data
            if (data4gl && data4gl.length > 0) {
              try {
                data4gl = JSON.parse(data4gl);
              } catch (err) {
              }

              // initial channel/event used as default if not updated by the
              // server
              if (!event4gl || event4gl.length === 0)
                event4gl = responseChannel || event;

              // if broadcast send to everyone, including the originator
              if (broadcast === true)
                return self.broadcast(responseChannel, data4gl);

              // if not to be broadcasted send it to the originator only
              if (socket)
                socket.emit(responseChannel, data4gl);
            }

          })['catch'](function(err) {
        if (socket)
          socket.emit(event, {
            error : err.message
          });

        self.log('error', err.message);

      })['finally'](function() {
        if (apiConn)
          apiConn.disconnect();
      });
    }
  };

  this.broadcast = function(event, data, socket) {

    if (event) {
      if (!socket) {
        self.io.emit(event, data);
      } else {
        // broadcast the event to all but the originator
        for ( var id in self.io.connected) {
          var conn = self.io.connected[id];

          if (conn !== socket)
            conn.emit(event, data);
        }
      }
    }
  };

  if (akeraWebApp !== undefined) {
    // mounted as application level service
    var AkeraWeb = null;

    try {
      AkeraWeb = akeraWebApp.require('akera-web');
    } catch (err) {
    }

    if (!AkeraWeb || !(akeraWebApp instanceof AkeraWeb))
      throw new Error('Invalid Akera web service instance');

    this.init(mainConfig, akeraWebApp.router);

  }
}

AkeraPush.init = function(config, router) {
  var akeraPush = new AkeraPush();
  akeraPush.init(config, router);
};
