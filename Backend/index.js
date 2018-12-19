const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require("cors");
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const MongoClient = require("mongodb").MongoClient;
const assert = require("assert");

var moment = require("moment");
moment().format("LLL");

app.use(cors());
app.use(bodyParser.json()); // accept JSON data
app.use(bodyParser.urlencoded({ extended: true })); // accept form data

// Connection URL
const url = "mongodb://localhost:27017";

// Database Name
const userDatabase = "userDatabase";
const messageDatabase = "messageDatabase";

/* helper functions */
var foundResult = null;

// add user
const insertUser = function(db, data, callback) {
  // Get the documents collection
  const collection = db.collection("documents");
  // Insert some documents
  collection.insertMany(
    [{ 
      username: data.username,
      password: data.password
    }], function(err, result) {
      assert.equal(err, null);
      assert.equal(1, result.ops.length);
      console.log("Inserted 1 user into the collection");
      callback(result);
    }
  );
};

// add message
const insertMessage = function(db, data, callback) {
  const collection = db.collection("documents");
  console.log(data);

  collection.insertMany(data, function(err, result) {
    assert.equal(err, null);
    assert.equal(1, result.ops.length);
    console.log("Inserted 1 message into the collection");
    callback(result);
  });
};

// search
const find = function(db, query, callback) {
  const collection = db.collection("documents");
  console.log(query);
  collection.find(query).toArray(function(err, docs) {
    assert.equal(err, null);
    console.log("Found the following number of records: " + docs.length);
    // console.log(docs);
    foundResult = docs;
    callback(docs);
  });
};

// last 50 messages
const findLast50Messages = function(db, query, callback) {
  const collection = db.collection("documents");
  console.log(query);
  collection.find(query).limit(50)
    .toArray(function(err, docs) {
      assert.equal(err, null);
      console.log("Found the following messages: " + docs.length);
      // console.log(docs);
      foundResult = docs;
      callback(docs);
    });
};

/* API calls */

// post create user
app.post("/api/create", function(req, res) {
  console.log(req.body);
  username = req.body.username;
  password = req.body.password;

  foundResult = null;
  data = { 
    username: username,
    password: password
  };
  if (data.username.length == 0 || data.password.length == 0) {
    res.status(401).send("No username or password.");
  } else {
    MongoClient.connect(url,
      function(err, client) {
        assert.equal(null, err);
        console.log("Connected successfully to server");

        const db = client.db(userDatabase);
        let query = {
          username: data.username
        };
        find(db, query, function() {
          if (foundResult.length == 0) {
            // username not found
            insertUser(db, data, function() {
              res.status(200).send({ username: username });
            });
          } else {
            res.status(401).send("User already exists.");
          }
          client.close();
        });
      });
    }
  });

// post login
app.post("/api/login", function(req, res) {
  console.log(req.body);
  username = req.body.username;
  password = req.body.password;

  foundResult = null;

  data = {
    username: username,
    password: password
  };

  if (data.username.length == 0 || data.password.length == 0) {
    res.status(401).send("No username or password.");
  } else {
    MongoClient.connect(url,
      function(err, client) {
        assert.equal(null, err);
        console.log("Connected successfully to server");

        const db = client.db(userDatabase);

        let query = {
          username: data.username
        };

        find(db, query, function() {
          if (foundResult.length != 0) {
            // validate password
            if (foundResult[0].username == username && foundResult[0].password == password)
            {
              res.status(200).send({ username: username });
            } else {
              res.status(401).send("Invalid Credentials.");
            }
          } else {
            res.status(401).send("User does not exist.");
          }
          client.close();
        });
      }
    );
  }
});

// post new message
io.on("connection", function(socket) {
  app.post("/api/chat/send", function(req, res) {
    // use socket .io here
    let sender = req.body.sender;
    let receiver = req.body.receiver;
    let message = req.body.message;
    let timeStamp = moment(new Date()).toString();

    let senderFound = null;
    let receiverFound = null;
    foundResult = null;

    let data = [{
      sender: sender,
      receiver: receiver,
      message: message,
      timeStamp: timeStamp
    }];

    console.log(data);

    if (sender != null && receiver != null && message.length != 0) {
      MongoClient.connect(url,
        function(err, client) {
          assert.equal(null, err);
          console.log("Connected successfully to server");

          const dbChat = client.db(messageDatabase);
          const dbUser = client.db(userDatabase);

          let query = {
            username: receiver
          };

          find(dbUser, query, function() {
            receiverFound = foundResult;

            if (receiverFound.length != 0) {
              console.log(receiver);
              foundResult = null;
              query = {
                username: sender
              };
              find(dbUser, query, function() {
                senderFound = foundResult;
                if (senderFound.length != 0) {
                  insertMessage(dbChat, data, function() {
                    res.status(200).send({ newMessage: data });
                    io.emit("messageChannel", {
                      sender: sender,
                      receiver: receiver,
                      message: message,
                      timeStamp: timeStamp
                    });
                    client.close();
                  });
                } else {
                  res.status(401).send("Invalid sender.");
                  client.close();
                }
                client.close();
              });
            } else {
              res.status(401).send("Invalid receiver.");
              client.close();
            }
          });
        }
      );
    } else {
      res.status(401).send("No sender, no reciever, or no message.");
    }
  });
});

// get all users to see who is available
app.get("/api/users", function(req, res) {
  MongoClient.connect(url,
    function(err, client) {
      assert.equal(null, err);
      console.log("Connected successfully to server");

      const db = client.db(userDatabase);

      let query = {};
      find(db, query, function() {
        if (foundResult.length != 0) {
          res.status(200).send(foundResult);
        } else {
          res.status(401).send("No users currently exist.");
        }
        client.close();
      });
    }
  );
});

// get user's last 50 messages sent or recieved
app.get("/api/chat/history/:username", function(req, res) {
  console.log(req.params.username);
  let user = req.params.username;

  foundResult = null;

  MongoClient.connect(url,
    function(err, client) {
      assert.equal(null, err);
      console.log("Connected successfully to server");

      const dbChat = client.db(messageDatabase);
      const dbUser = client.db(userDatabase);

      let query = {
        username: user
      };
      let messagesFound = null;

      find(dbUser, query, function() {
        if (foundResult.length != 0) {
          foundResult = null;
          query = { $or:
            [{
              receiver: user
            }, {
              sender: user
            }]
          };
          findLast50Messages(dbChat, query, function() {
            messagesFound = foundResult;
            if (messagesFound.length != 0) {
              messagesFound = messagesFound.sort({ timeStamp: -1 });
            }

            res.status(200).send(messagesFound);

            client.close();
          });
        } else {
          res.status(401).send("Invalid user.");
          client.close();
        }
      });
    }
  );
});

// get conversation
app.get("/api/chat/:username1/:username2", function(req, res) {
  console.log(req.params.username1);
  console.log(req.params.username2);

  let user1 = req.params.username1;
  let user2 = req.params.username2;

  MongoClient.connect(url,
    function(err, client) {
      assert.equal(null, err);
      console.log("Connected successfully to server");

      const dbChat = client.db(messageDatabase);
      const dbUser = client.db(userDatabase);

      let query = {
        username: user1
      };
      find(dbUser, query, function() {
        if (foundResult.length != 0) {
          foundResult = null;
          query = {
            username: user2
          };
          find(dbUser, query, function() {
            if (foundResult.length != 0) {
              foundResult = null;
              query = {$or: 
                [{
                  $and: 
                  [{
                    receiver: user1
                  }, {
                    sender: user2
                  }]
                }, {
                  $and:
                  [{
                    receiver: user2
                  }, {
                    sender: user1
                  }]
                }]
              };
              find(dbChat, query, function() {
                let conversation = foundResult;
                console.log(conversation);
                if (foundResult.length != 0) {
                  conversation = conversation.sort({ timeStamp: -1 });
                }
                res.status(200).send(conversation);
                client.close();
              });
            } else {
              res.status(401).send("Second user does not exist.");
              client.close();
            }
          });
        } else {
          res.status(401).send("First user does not exist.");
          client.close();
        }
      });
    }
  );
});

io.on("disconnect", function() {
  console.log("User disconnected from socket");
});

http.listen(3000);