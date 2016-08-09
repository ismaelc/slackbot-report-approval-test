/*
This is a bot running in Heroku to test interactive buttons on Concur Report Approvals
pulled from this example - https://github.com/howdyai/botkit/blob/master/examples/slackbutton_bot_interactivemsg.js
Ran in Heroku to start with generic code that can easily be run in other hosting services e.g. Amazon

Environment Variables:
- SLACK_CLIENT_ID
- SLACK_CLIENT_SECRET
- CONCUR_CLIENT_ID
- CONCUR_SECRET_KEY
- CONCUR_SCOPE
- CONCUR_WS_ADMIN_TOKEN
- HOST_URL

TODO: Check all lines marked with TODO
Also:
    - Write logic to check if the buttons were clicked by the right person
    - Or, restrict chat to non-channel conversations
    - Replace Redis with Amazon DynamoDB - https://github.com/joshuahoover/botkit-storage-dynamodb
    - Host the bot in Amazon
    - Format dates/currencies/amounts
    - Reply to random things like hello


    Some problems encountered (and fixed):
    - change process.env.port to PORT
    - remove http listen from the end of the code (?)
    - Instructions from example above didn't include enabling Interactive Buttons in the App Configuration and adding /slack/receive to the Redirect url
    - Adding clientId and clientSecret as config vars to Heroku
*/

// Import Botkit and configure Redis storage (added as add-on in Heroku portal)
var Botkit = require('botkit'),
    url = require('url'),
    redisURL = url.parse(process.env.REDIS_URL),
    redisConfig = {
        namespace: 'botkit-example',
        host: redisURL.hostname,
        port: redisURL.port,
        auth_pass: redisURL.auth.split(":")[1]
    }
redisStorage = require('botkit-storage-redis')(redisConfig);
var http = require('http');
var concur = require('./concur.js');
//var express = require('express');
//var app = express();

var SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
var SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
var CONCUR_CLIENT_ID = process.env.CONCUR_CLIENT_ID; // TODO: These ought to be in concur.js
var CONCUR_SCOPE = process.env.CONCUR_SCOPE;
var HOST_URL = process.env.HOST_URL;

//TODO: Delete or limit this to prevent memory leak
var temp_code = [];

//if (!process.env.clientId || !process.env.clientSecret || !process.env.PORT) {
if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !process.env.PORT) {
    console.log('Error: Specify clientId clientSecret and port in environment');
    process.exit(1);
}

function pushTempCode(code) {
    //TODO: Change this to expunge array or limit, to avoid memory leak
    temp_code.push(code);
}

// Configure Slack + Redis storage
var controller = Botkit.slackbot({
    storage: redisStorage
}).configureSlackApp({
    clientId: SLACK_CLIENT_ID,
    clientSecret: SLACK_CLIENT_SECRET,
    scopes: ['bot'],
});

// This is like express(), so you can set up routes here
controller.setupWebserver(process.env.PORT, function(err, webserver) {

    // Display the login link
    webserver.get('/', function(req, res) {
        res.send('<a href="' + HOST_URL + '/login">Login</a>');
    });

    // Handles Concur /redirect
    webserver.get('/redirect', function(req, res) {
        console.log("Request: " + JSON.stringify(req.query));

        //TODO: Stop living on the edge, rethink how to store (queue?) 'code' received from Concur
        pushTempCode(req.query.code);

        // Display the code. TODO: Make this look better
        res.send(req.query);
    });

    // This probably sets up whatever endpoints are needed by Botkit to talk to Slack
    controller.createWebhookEndpoints(controller.webserver);

    // Sets up auth endpoints for Botkit - Slack
    controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            //TODO: Send something better, like html?
            res.send('Your bot is connected!');
        }
    });
});

// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};

function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

/*
// This was for testing hardcoded non-oauth Slack bots
var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();
*/

// Handles the button click in Slack
controller.on('interactive_message_callback', function(bot, message) {


    var callback_id = message.callback_id; // Callback id of report being updated
    var action = message.actions[0].value; // Action of button that was clicked (Approve/Reject)

    var reply = message.original_message; // Get the original message so we can repaint the attachments

    reply['replace_original'] = true; // This baby makes sure that attachments are replaced with new ones below..

    // Find report with matching callback_id so we can change the buttons to Approved or Rejected
    for (var i = 0, len = reply.attachments.length; i < len; i++)
        if (reply.attachments[i].callback_id == callback_id) break; // I want to avoid async forgive me

    if (i < reply.attachments.length) { //found report

        // TODO: Pass these as object instead? Or move them to concur.js
        // Confirm text will replace the buttons
        // Command and comment are what's passed to Concur Approval's POST body
        var action_confirm_text = ":x: Rejected";
        var action_command = 'Send Back to Employee';
        var comment = 'Report sent back to employee';

        if (action == 'approve') {
            action_confirm_text = ":white_check_mark: Approved";
            action_command = 'Approve';
            comment = 'Report is approved';
        }

        // Get all pending reports
        concur.executePendingReports(callback_id, action_command, comment, function(err, result) {

            if (!err) {

                reply.attachments[i].actions = []; // Empty the buttons
                reply.attachments[i].fields.push({ // Replace it with the appropriate confirm text
                    "value": action_confirm_text
                });

            } else {
                //TODO: Test this
                // reply with error on new line
                bot.reply(message, err);
            }

            bot.replyInteractive(message, reply);
        });
    }
});

controller.on('create_bot', function(bot, config) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
    } else {
        bot.startRTM(function(err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({
                user: config.createdBy
            }, function(err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                    convo.say('You must now /invite me to a channel so that I can be of use!');
                }
            });

        });
    }

});

// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function(bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function(bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});

// Concur Login
controller.hears(['login'], ['direct_message', 'direct_mention'], function(bot, message) {

    // Check if user exists
    controller.storage.users.get(message.user, function(err, user) {

        // If user exists and has token, then already logged in. TODO: Rewrite with better checking
        if (user && user.hasOwnProperty("concur_token") && user['concur_token']) {
            bot.reply(message, "You are already logged in.");
        } else {
            //... else, start the login flow

            // Use convo so we can prompt for input
            bot.startConversation(message, function(err, convo) {

                // Send Concur login link, and wait for 'code' to be typed in by user
                var login_reply = "1. Click this to login: -> " + "https://www.concursolutions.com/net2/oauth2/Login.aspx?client_id=" + CONCUR_CLIENT_ID + "&scope=" + CONCUR_SCOPE + "&redirect_uri=" + HOST_URL + "/redirect&state=\
                                    \n2. Type in your code below: ";

                convo.ask(login_reply, function(response, convo) {

                    var code_from_user = response.text; // code entered by user
                    //TODO: Replace this with something better, impending memory leak
                    // After 1. above, 'code' would have been saved by the application already
                    // This if logic below simply tries to match whatever's already there and
                    // what was entered by the user
                    if (temp_code.indexOf(code_from_user) >= 0) {
                        // Code exists in application, call Concur token exchange
                        concur.exchangeCodeForToken(code_from_user, function(error, result) {

                            if (!error) {

                                var access_token = result;

                                // Create user object to save to storage
                                // Maps Slack user to Concur access token
                                user = {
                                    id: message.user,
                                    concur_token: access_token
                                }

                                // Save user to storage
                                controller.storage.users.save(user);

                                convo.say("You are logged in! Type *pending approval*");

                            } else {
                                //TODO: Test this
                                convo.say(JSON.stringify({
                                    'error': error,
                                    'access_token': null
                                }));
                            }

                            // Exit out of prompt (surely there's a better way to do this)
                            convo.next();
                        });
                    } else {
                        // Was the user typing some gibberish 'code' ?
                        convo.say(JSON.stringify({
                            'error': 'No code matched',
                            'access_token': null
                        }));

                        convo.next();
                    }
                });
            })
        }
    });
});

// Concur Logout
controller.hears(['logout'], ['direct_message', 'direct_mention'], function(bot, message) {

    controller.storage.users.get(message.user, function(err, user) {
        if (!user) {
            bot.reply(message, "You're not logged in");
        } else {
            user['concur_token'] = null;
            controller.storage.users.save(user);
            bot.reply(message, "Logged out");
        }
    });
});

// Concur Pending Approvals
controller.hears(['pending approval'], ['direct_message', 'direct_mention'], function(bot, message) {

    // Get user who typed 'pending approval' so that we can retrieve Concur tokens if they are logged in
    controller.storage.users.get(message.user, function(err, user) {

        // Check if user is logged in. Surely there's a better way to check this
        if (!err && user && user.hasOwnProperty("concur_token") && user['concur_token']) {

            var access_token = user['concur_token'];
            console.log('LOGGED IN: ' + access_token);

            // Initialize report variables to populate 'attachments' that will be displayed in Slack
            var report_ctr = 0;
            var report_workflowstepid, report_ownername, report_name, report_date, report_amount, report_status;
            var attachments = [];

            // Get Concur pending reports
            concur.getPendingReports(access_token, function(err, result) {

                // Less headache
                result = result[0];
                //console.log("TESTING: " + JSON.stringify(result));

                if (result) {
                    // Loop through reports to turn them into Slack attachments
                    report_ctr = result['Report'].length;
                    for (var i = 0, len = report_ctr; i < len; i++) {

                        report_workflowstepid = result['Report'][i]['WorkflowActionUrl'][0].split('/')[8]; // screw regex
                        report_ownername = result['Report'][i]['OwnerName'][0];
                        report_name = result['Report'][i]['Name'][0];
                        report_date = result['Report'][i]['SubmitDate'][0];
                        report_amount = result['Report'][i]['Total'][0];
                        report_status = result['Report'][i]['ApprovalStatusName'][0];

                        // Push each report as an attachment
                        attachments.push({
                            "callback_id": report_workflowstepid,
                            "pretext": "*" + report_ownername + "*'s outstanding report for your review.",
                            "mrkdwn_in": ["text", "pretext"],
                            "fields": [{
                                "title": "Report Name",
                                "value": report_name,
                                "short": true
                            }, {
                                "title": "Date",
                                "value": report_date,
                                "short": true
                            }, {
                                "title": "Amount",
                                "value": report_amount,
                                "short": true
                            }, {
                                "title": "Status",
                                "value": report_status,
                                "short": true
                            }],
                            "actions": [{
                                "name": "Approve",
                                "text": "Approve",
                                "type": "button",
                                "style": "primary",
                                "value": "approve"
                            }, {
                                "name": "Reject",
                                "text": "Reject",
                                "type": "button",
                                "style": "danger",
                                "value": "reject"
                            }]
                        });
                    }
                    // Show reports to user
                    bot.reply(message, {
                        attachments: attachments
                    }, function(err, resp) {
                        console.log(err, resp)
                    });
                }
                else {
                    bot.reply(message, "No pending reports for you.");
                }
            });

        } else { // You're not logged in brah

            var reply;

            if (err) {
                console.log('ERROR: ' + err);
                reply = err;
                //TODO: Fix this if statement
            } else if (!user || (user.hasOwnProperty("concur_token") && !user['concur_token'])) {
                console.log('NOT LOGGED IN');
                reply = "You have to login first. Type *login*";
            }

            bot.reply(message, reply, function(err, resp) {
                console.log(err, resp)
            });
        }
    });
})

controller.storage.teams.all(function(err, teams) {

    if (err) {
        throw new Error(err);
    }

    // connect all teams with bots up to slack!
    for (var t in teams) {
        if (teams[t].bot) {
            controller.spawn(teams[t]).startRTM(function(err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }
});


/*
// To keep Heroku's free dyno awake. We don't need this for non-Hobby accounts
http.createServer(function(request, response) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    response.end('Ok, dyno is awake.');
}).listen(process.env.PORT || 5000);
*/
