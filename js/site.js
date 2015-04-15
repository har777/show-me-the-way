var osmStream = require('osm-stream'),
    reqwest = require('reqwest'),
    moment = require('moment'),
    _ = require('underscore');

//URL Design : 'localhost:8000/#bbox=-90,-180,90,180&users=har777,geohacker&comments=mapbox&speed=100'

// Used to parse the url hash. Pass in any url with the hash format '#key1=val1,val2&key2=val1,val2,val3' and it returns an object with the hash key-value pairs.
function parseParms(str) {
    var pieces = str.split("&"), data = {}, i, parts;
    for (i = 0; i < pieces.length; i++) {
        parts = pieces[i].split("=");
        if (parts.length < 2) {
            parts.push("");
        }
        data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
    }
    return data;
}

var filterDataParams = {};

if(location.hash){
    // Parsing and storing url hash keys to object.
    var filterDataParamsString = window.location.hash.split('#')[1];
    var filterDataParams = parseParms(filterDataParamsString);
}

var bboxString = ["-90.0", "-180.0", "90.0", "180.0"];
if('bbox' in filterDataParams) {
    var bboxString = filterDataParams['bbox'].split(',');
}

var filteredUsers = [];
if('users' in filterDataParams) {
    var filteredUsers = filterDataParams['users'].split(',');
}

var filteredCommentTerms = [''];
if('comments' in filterDataParams) {
    var filteredCommentTerms = filterDataParams['comments'].split(',');
}

var runSpeed = 2000;
if('speed' in filterDataParams) {
    var runSpeed = parseInt(filterDataParams['speed']);
}

console.log(bboxString, filteredUsers, filteredCommentTerms, runSpeed);

var ignore = ['bot-mode'];
var BING_KEY = 'Arzdiw4nlOJzRwOz__qailc8NiR31Tt51dN2D7cm57NrnceZnCpgOkmJhNpGoppU';

var map = L.map('map', {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false
}).setView([51.505, -0.09], 13);

var overview_map = L.map('overview_map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false
}).setView([51.505, -0.09], 1);

var bing = new L.BingLayer(BING_KEY, 'Aerial').addTo(map);

var osm = new L.TileLayer('//a.tiles.mapbox.com/v3/saman.map-f8nluy8d/{z}/{x}/{y}.jpg70', {
    minZoom: 4,
    maxZoom: 8,
    attribution: '<a href="http://mapbox.com/about/maps/">Terms &amp; Conditions</a>'
}).addTo(overview_map);

var lineGroup = L.featureGroup().addTo(map);

var changeset_info = document.getElementById('changeset_info');
var changeset_tmpl = _.template(document.getElementById('changeset-template').innerHTML);
var queue = [];

// Remove Leaflet shoutouts
map.attributionControl.setPrefix('');
overview_map.attributionControl.setPrefix('');

var bbox = new L.LatLngBounds(
        new L.LatLng(+bboxString[0], +bboxString[1]),
        new L.LatLng(+bboxString[2], +bboxString[3]));

changeset_info.innerHTML = '<div class="loading">loading...</div>';

var lastLocation = L.latLng(0, 0);

function farFromLast(c) {
    try {
        return lastLocation.distanceTo(c) > 1000;
    } finally {
        lastLocation = c;
    }
}

function showLocation(ll) {
    var nominatim_tmpl = '//nominatim.openstreetmap.org/reverse?format=json' +
        '&lat={lat}&lon={lon}&zoom=5';
    reqwest({
        url: nominatim_tmpl.replace('{lat}', ll.lat).replace('{lon}', ll.lng),
        crossOrigin: true,
        type: 'json'
    }, function(resp) {
        document.getElementById('reverse-location').innerHTML =
            '' + resp.display_name + '';
    });
}

function showComment(id) {
    var changeset_url_tmpl = '//www.openstreetmap.org/api/0.6/changeset/{id}';
    reqwest({
        url: changeset_url_tmpl
            .replace('{id}', id),
        crossOrigin: true,
        type: 'xml'
    }, function(resp) {
        var tags = resp.getElementsByTagName('tag');
        var comment = '',
            editor = '';
        for (var i = 0; i < tags.length; i++) {
            if (tags[i].getAttribute('k') == 'comment') {
                comment = tags[i].getAttribute('v').substring(0, 60);
            }
            if (tags[i].getAttribute('k') == 'created_by') {
                editor = tags[i].getAttribute('v').substring(0, 50);
            }
        }
        document.getElementById('comment').innerHTML = comment + ' in ' + editor;
    });
}

/*
function fetchComment(id) {
    var changeset_url_tmpl = '//www.openstreetmap.org/api/0.6/changeset/{id}';
    var comment = '';
    reqwest({
        url: changeset_url_tmpl
            .replace('{id}', id),
        crossOrigin: true,
        type: 'xml'
    }, function(resp) {
        var tags = resp.getElementsByTagName('tag');
        for (var i = 0; i < tags.length; i++) {
            if (tags[i].getAttribute('k') == 'comment') {
                comment = tags[i].getAttribute('v').substring(0, 60);
            }
        }
    });
    return comment;
}
*/

//Store containing changeset as key and comment as value. 
var comments = {};

// The number of changes to show per minute
osmStream.runFn(function(err, data) {
    queue = _.filter(data, function(f) {
        // Checking if user in filtered list.
        if(filteredUsers.length == 0) {var userCleared = true;}
        else {var userCleared = filteredUsers.indexOf(f.meta.user) > -1; console.log(userCleared);}
        console.log(f.meta.user);
        //Checking if comment contains required term. eg. Mapbox.
        var comment = ''; 
        //comment = fetchComment(f.feature.changeset);

        console.log(f.feature.changeset);
        if(f.feature.changeset in comments) {
            comment = comments[f.feature.changeset];
            //console.log('found in cache');
        }
        else {  
            var xmlHttp = null;
            xmlHttp = new XMLHttpRequest();
            xmlHttp.open( "GET", '//www.openstreetmap.org/api/0.6/changeset/' + f.feature.changeset, false );
            xmlHttp.send( null );
            var changesetResponse = xmlHttp.response;

            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(changesetResponse, "text/xml");
            var tags = xmlDoc.getElementsByTagName('tag');

            for (var i = 0; i < tags.length; i++) {
                if (tags[i].getAttribute('k') == 'comment') {
                    comment = tags[i].getAttribute('v').substring(0, 60);
                }
            }
            comments[f.feature.changeset] = comment;
            //console.log(comment);
            //console.log('added to cache');
        }

        comment = comment.toLowerCase();

        if(filteredCommentTerms.length != 0 && comment.length == 0) {var commentCleared = false;}
        else if(filteredCommentTerms.length == 0 && comment.length == 0) {var commentCleared = true;}
        else {var commentCleared = comment.indexOf(filteredCommentTerms[0].toLowerCase()) > -1;}
        
        return f.feature && f.feature.type === 'way' &&
            (bbox.intersects(new L.LatLngBounds(
                new L.LatLng(f.feature.bounds[0], f.feature.bounds[1]),
                new L.LatLng(f.feature.bounds[2], f.feature.bounds[3])))) &&
            f.feature.linestring &&
            moment(f.meta.timestamp).format("MMM Do YY") === moment().format("MMM Do YY") &&
            ignore.indexOf(f.meta.user) === -1 &&
            f.feature.linestring.length > 4 &&
            userCleared &&
            commentCleared;
    }).sort(function(a, b) {
        return (+new Date(a.meta.tilestamp)) -
            (+new Date(b.meta.tilestamp));
    });
    // if (queue.length > 2000) queue = queue.slice(0, 2000);
    // runSpeed = 500;
});

function doDrawWay() {
    document.getElementById('queuesize').innerHTML = queue.length;
    if (queue.length) {
        drawWay(queue.pop(), function() {
            doDrawWay();
        });
    } else {
        window.setTimeout(doDrawWay, runSpeed);
    }
}

function pruneLines() {
    var mb = map.getBounds();
    lineGroup.eachLayer(function(l) {
        if (!mb.intersects(l.getBounds())) {
            lineGroup.removeLayer(l);
        } else {
            l.setStyle({ opacity: 0.5 });
        }
    });
}

function setTagText(change) {
    var showTags = ['building', 'natural', 'leisure', 'waterway',
        'barrier', 'landuse', 'highway', 'power'];
    for (var i = 0; i < showTags.length; i++) {
        if (change.feature.tags[showTags[i]]) {
            change.tagtext = showTags[i] + '=' + change.feature.tags[showTags[i]];
            return change;
        }
    }
    change.tagtext = 'a way';
    return change;
}

function drawWay(change, cb) {
    pruneLines();

    var way = change.feature;

    // Zoom to the area in question
    var bounds = new L.LatLngBounds(
        new L.LatLng(way.bounds[2], way.bounds[3]),
        new L.LatLng(way.bounds[0], way.bounds[1]));

    if (farFromLast(bounds.getCenter())) showLocation(bounds.getCenter());
    showComment(way.changeset);

    var timedate = moment(change.meta.timestamp);
    change.timetext = timedate.fromNow();

    map.fitBounds(bounds);
    overview_map.panTo(bounds.getCenter());
    changeset_info.innerHTML = changeset_tmpl({ change: setTagText(change) });

    var color = { 'create': '#B7FF00', 'modify': '#FF00EA', 'delete': '#FF0000' }[change.type];
    if (change.feature.tags.building || change.feature.tags.area) {
        newLine = L.polygon([], {
            opacity: 1,
            color: color,
            fill: color
        }).addTo(lineGroup);
    } else {
        newLine = L.polyline([], {
            opacity: 1,
            color: color
        }).addTo(lineGroup);
    }
    // This is a bit lower than 3000 because we want the whole way
    // to stay on the screen for a bit before moving on.
    var perPt = runSpeed / way.linestring.length;

    function drawPt(pt) {
        newLine.addLatLng(pt);
        if (way.linestring.length) {
            window.setTimeout(function() {
                drawPt(way.linestring.pop());
            }, perPt);
        } else {
            window.setTimeout(cb, perPt * 2);
        }
    }
    newLine.addLatLng(way.linestring.pop());
    drawPt(way.linestring.pop());
}

doDrawWay();