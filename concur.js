var request = require('request');
var cheerio = require('cheerio');

//TODO: WS admin token needs to be computed (refreshed), not hardcoded into env
var CONCUR_WS_ADMIN_TOKEN = process.env.CONCUR_WS_ADMIN_TOKEN;
var CONCUR_CLIENT_ID = process.env.CONCUR_CLIENT_ID;
var CONCUR_SECRET_KEY = process.env.CONCUR_SECRET_KEY;

function exchangeCodeForToken(code, callback_) {

    if (!code) {
        callback_({
            'error': 'No code passed to exchangeCodeForToken()'
        }, null);
    }

    request('https://www.concursolutions.com/net2/oauth2/GetAccessToken.ashx?&code=' +
        code +
        '&client_id=' + CONCUR_CLIENT_ID +
        '&client_secret=' + CONCUR_SECRET_KEY,
        function(error, response, body) {
            var token_response = null;
            if (!error && response.statusCode == 200) {
                console.log(body);
                //token_response = body;

                var cheerio = require("cheerio"),
                    html = body,
                    $ = cheerio.load(html, {
                        xmlMode: true
                    });

                console.log($("Token").text());
                token_response = $("Token").text();

            } else {
                error = response.body;
            }

            callback_(error, token_response);
        })

}

function getPendingReports(access_token, callback_) {

    if (!access_token) {
        callback_({
            'error': 'No access token passed to getPendingReports()'
        }, null);
    }

    var options = {
        url: 'https://www.concursolutions.com/api/v3.0/expense/reports?limit=15&approvalStatusCode=A_PEND&user=ALL',
        headers: {
            'Authorization': 'OAuth ' + access_token
        }
    };

    request(options, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var result = body;
            //console.log("getPendingReports result: " + result);

            var parseString = require('xml2js').parseString;
            var xml = result;
            parseString(xml, function(err, json_result) {

                if (err) {
                    callback_(err, null);
                }
                console.log("json_result: " + json_result['Reports']['Items']);

                // returns array [] of 'Report'
                callback_(null, json_result['Reports']['Items']);
            });
        } else {
            //console.log("HERE: " + response.statusCode);
            error = response.body;
            callback_(error, null);
        }
    });
}

function executePendingReports(workflowStepID, action, comment, callback_) {

    if (!workflowStepID) {
        callback_({
            'error': 'No workflowStepID passed to executePendingReports()'
        }, null);
    }

    var workflowAction =
        '<WorkflowAction xmlns="http://www.concursolutions.com/api/expense/expensereport/2011/03"> \
        <Action>'+ action +'</Action> \
        <Comment>' + comment + '</Comment> \
    </WorkflowAction>';

    request.post({
            url: 'https://www.concursolutions.com/api/expense/expensereport/v1.1/report/' + workflowStepID + '/workflowaction',
            body: workflowAction,
            headers: {
                'Authorization': 'OAuth ' + CONCUR_WS_ADMIN_TOKEN,
                'Content-Type': 'text/xml'
            }
        },
        function(error, response, body) {
            if (!error && response.statusCode == 200) {
                console.log('executePendingReports() response: ' + body);
                callback_(null, body);
            } else {
                error = response.body;
                console.log('executePendingReports() error: ' + error);
                callback_(error, null);
            }
        }
    );
}

exports.exchangeCodeForToken = exchangeCodeForToken;
exports.getPendingReports = getPendingReports;
exports.executePendingReports = executePendingReports;
