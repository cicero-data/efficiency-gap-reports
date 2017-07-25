var fs = require('fs'),
    csv = require('csv-parse'),
    d3 = Object.assign({}, require("d3-geo"), require("d3-geo-projection"), require('d3-scale'), require('d3-color')),
    Canvas = require('canvas'),
    YAML = require('yamljs');

// Load configuration
var config = YAML.load('config.yml');

// Print some helpful information to console
process.stdout.write(
  '===============================\n' +
  'Reporting Efficiency Gap Scores\n' +
  '===============================\n' +
  'Election results: ' + config.filename + '\n' +
  'District boundaries: ' + config.geojson + '\n\n' +
  'Infographics being added to `' + config.outputDirectory + '`\n\n'
);


// Defining Classes

// District: a geographic area represented by one seat in the delegation; votes are cast for one candidate in each party
class District {
  constructor(identifier, votes, feature) {
    this.identifier = identifier;
    this.votes = votes.map(function(v) { return parseInt(v, 10); });
    this.boundary = feature;
  }

  // Result: index of the victorious party; 0=left, 1=right
  get result() {
    return this.votes[0] > this.votes[1] ? 0 : 1;
  }

  // Margin: the number of left-candidate's votes subtracted from the number of right-candidates vote; negative numbers show left victory
  get margin() {
    return this.votes[1] - this.votes[0];
  }
}

// A collection of districts
class Delegation {
  constructor(name, abbreviation, districts) {
    this.name = name;
    this.abbreviation = abbreviation;
    this.districts = districts;
  }

  // Seats: the number of seats in the delegation, one for each district
  get seats() {
    return this.districts.length;
  }

  // Seat Results: the number of seats won by each party
  get seatResults() {
    var seatResults = [0,0];
    this.districts.map(function(d) {
      seatResults[d.result]++
    });
    return seatResults;
  }

  // Vote Results: the number of votes won by each party
  get voteResults() {
    var voteResults = [0,0];
    for (var i = 0; i < this.districts.length; i++) {
      voteResults[0] += this.districts[i].votes[0];
      voteResults[1] += this.districts[i].votes[1];
    };
    return voteResults;
  }

  // Vote Results Imputation: imputes (guesses) the number of votes that would have been won by each party if all seats had been contested
  // Conservatively assumes uncontesting party would have won additional votes ammounting to 25% of the new total
  get voteResultsImputation() {
    var voteResultsImputation = [0,0];
    for (var i = 0; i < this.districts.length; i++) {
      voteResultsImputation[0] += this.districts[i].votes[0] > 0 ? this.districts[i].votes[0] : Math.round(this.districts[i].votes[1] * (1/3));
      voteResultsImputation[1] += this.districts[i].votes[1] > 0 ? this.districts[i].votes[1] : Math.round(this.districts[i].votes[0] * (1/3));
    };
    return voteResultsImputation;
  }

  // Uncontested Seats: the number of seats left uncontested by each party
  get uncontestedSeats() {
    var uncontested = [0,0];
    var districts = this.districts;
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].votes[0] === 0) { uncontested[0]++; };
      if (districts[i].votes[1] === 0) { uncontested[1]++; };
    };
    return uncontested;
  }

  // Votes: the total number of votes cast
  get votes() {
    return this.voteResults[0] + this.voteResults[1];
  }

  // Votes Imputation: imputes (guesses) the total number of votes that would have been cast if all seats had been contested
  get votesImputation() {
    return this.voteResultsImputation[0] + this.voteResultsImputation[1];
  }

  // Seat Margin: the amount above or below 50% of all the seats that were won by the right-party; negative indicates left-party won more seats
  get seatMargin() {
    return this.seatResults[1] / this.seats - 0.5;
  }

  // Vote Margin: the amount above or below 50% of all the votes that were won by the right-party; negative indicates left-party won more votes
  get voteMargin() {
    return this.voteResults[1] / this.votes - 0.5;
  }

  // Vote Margin Imputation: imputes (guesses) the Vote Margin if all seats had been contested
  get voteMarginImputation() {
    return this.voteResultsImputation[1] / this.votesImputation - 0.5;
  }

  // Efficiency Gap: a measure of how effectively votes were distributed by the right-party; negative indicates votes were more effectively distributed by the left-party
  get efficiencyGap() {
    return this.seatMargin - (2 * this.voteMargin);
  }

  // Efficiency Gap Imputation: imputes (guesses) the Efficiency Gap if all seats had been contested
  get efficiencyGapImputation() {
    return this.seatMargin - (2 * this.voteMarginImputation);
  }

  // Efficiency Gap Seats: the seat advantage in the Delegation that results from the Efficiency Gap; negative indicates the left-party had an advantage
  get efficiencyGapSeats() {
    if (this.seats === 1) { return 0; }
    else {
      var efficiencyGapSeats = Math.round(Math.abs(this.efficiencyGap * this.seats));
      if (efficiencyGapSeats === 0) { return 0; }
      else {
        var benefittingParty = this.efficiencyGap < 0 ? 0 : 1;
        return efficiencyGapSeats < this.seatResults[benefittingParty] ? efficiencyGapSeats : this.seatResults[benefittingParty];
      }
    }
  }

  // Efficiency Gap Seats Imputation: imputes (guesses) the Efficiency Gap Seats if all seats had been contested
  get efficiencyGapSeatsImputation() {
    if (this.seats === 1) { return 0; }
    else {
      var efficiencyGapSeats = Math.round(Math.abs(this.efficiencyGapImputation * this.seats));
      if (efficiencyGapSeats === 0) { return 0; }
      else {
        var benefittingParty = this.efficiencyGapImputation < 0 ? 0 : 1;
        return efficiencyGapSeats < this.seatResults[benefittingParty] ? efficiencyGapSeats : this.seatResults[benefittingParty];
      }
    }
  }

  // District Boundaries: a GeoJSON FeatureCollection of the District's geographic bounds
  get districtBoundaries() {
    var boundaries = { type: 'FeatureCollection', features: [] };
    for (var d = 0; d < this.districts.length; d++) {
      boundaries.features.push(this.districts[d].boundary);
    }
    return boundaries;
  }

}

// Party: one of two political parties in the election
class Party {
  constructor(name, color) {
    this.name = name;
    this.color = color;
  }
}

// Election Results: the results for a set of Delegations from an election between a left-Party and a right-Party
class ElectionResults {
  constructor(leftParty, rightParty, delegations) {
    this.parties = { left: leftParty, right: rightParty };
    this.delegations = delegations;
  }
}


// Empty arrays for recording delegations
var delegationIdentifiers = [],
    collectedDelegations = [];

// Load CSV and GeoJSON file
var csvData = fs.readFileSync(config.filename, 'utf8');
var geojson = JSON.parse(fs.readFileSync(config.geojson, 'utf8'));

// Reformat CSV results and GeoJSON boundaries to an Election Results
csv(csvData, { columns: true }, function(err,data) {

  data.map(function(d) {

    var delegationIdentifier = d[config.delegationIdentifier]

    // Add new delegation
    if (delegationIdentifiers.indexOf(delegationIdentifier) === -1) {
      delegationIdentifiers.push(delegationIdentifier);
      var delegationName = d[config.delegationName];
      collectedDelegations.push(new Delegation(delegationName, delegationIdentifier, []))
    }

    var delegationIndex = delegationIdentifiers.indexOf(delegationIdentifier);

    // Add new district
    var districtIdentifier = d[config.districtIdentifier];
    var districtVotes = [d[config.partyLeftVotes], d[config.partyRightVotes]];
    var districtFeature = geojson.features.filter(function(f) {
      return f.properties[config.delegationIdentifier] === delegationIdentifier && f.properties[config.districtIdentifier] === districtIdentifier;
    })[0];

    collectedDelegations[delegationIndex].districts.push(new District(districtIdentifier, districtVotes, districtFeature));

  });

  var dataLeftParty = new Party(config.partyLeftName, '#45bae8');
  var dataRightParty = new Party(config.partyRightName, '#ff595f');

  var results = new ElectionResults(dataLeftParty, dataRightParty, collectedDelegations);

  var states = [];
  results.delegations.map(function(d) {
    states.push([d.name, d.efficiencyGap, d.seats, d.efficiencyGapSeats]);
  });

  // Generate infographics
  report(results);
});

// A function that generates infographics from an Election Results object
function report(election) {

  // Generate a report for each Delegation
  for (var i = 0; i < election.delegations.length; i++) {

    var delegation = election.delegations[i];
    var districts = delegation.districtBoundaries;

    // Party Advantage
    var advantageParty = undefined;
    if (delegation.efficiencyGapImputation <= 0) { advantageParty = 'left'; }
    if (delegation.efficiencyGapImputation > 0) { advantageParty = 'right'; }

    // Formatted Efficiency Gap advantage
    var efficiencyGapPercent = Math.round(Math.abs(delegation.efficiencyGapImputation) * 1000) / 10 + '%'

    // Canvas dimensions
    var width = 1200,
        height = 630,
        leftMargin = 60;

    // A new Canvas object to draw on
    var canvas = new Canvas(width, height),
        context = canvas.getContext("2d");


    // Design Parameters //

    // Layout
    var grid = Math.floor(height / 10);

    // Style
    var background = '#292d39',
        titleFont = 'bold 42px Helvetica',
        subtitleFont = '34px Helvetica',
        sentenceFill = '#fff',
        sentenceFont = '34px Helvetica',
        sentenceBoldFont = 'bold 34px Helvetica',
        annotationFont = 'bold 20px Helvetica',
        annotationMargin = 10,
        disclaimerFont = '15px Helvetica',
        districtStroke = '#fff',
        annotationColor = '#ccc';

    // Bar Graph
    var graphWidth = width / 2 - leftMargin,
        graphHeight = 260,
        graphOriginX = leftMargin,
        graphOriginY = Math.floor(grid * 4),
        rectangleHeight = Math.round(graphHeight * 0.15);

    // Map
    var mapWidth = width * 0.44,
        mapHeight = height - Math.round(grid * 1.5);

    // Background
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Custom map projection for each Delegation
    var projection = d3.geoAlbers();
    var path = d3.geoPath()
        .projection(projection);

    var b = path.bounds(districts),
      centroid = d3.geoCentroid(districts),
      pOffset = b[1][1] - b[0][1] * 0.3;

    projection
        .rotate([-1 * centroid[0]])
        .scale(1)
        .translate([0, 0]);

    bounds = path.bounds(districts);

    var scale = 0.9 / Math.max((bounds[1][0] - bounds[0][0]) / mapWidth, (bounds[1][1] - bounds[0][1]) / mapHeight),
        translate = [(mapWidth - scale * (bounds[1][0] + bounds[0][0])) / 2 + (width - mapWidth), grid * 1.5 + (mapHeight - scale * (bounds[1][1] + bounds[0][1])) / 2];

    projection
        .scale(scale)
        .translate(translate);

    // Draw districts shadow
    context.fillStyle = d3.color(background).darker(1).toString();
    context.beginPath();
    path.context(context)(districts);
    context.fill();


    // Draw districts
    translate[0] -= 6;
    translate[1] -= 6;

    projection.translate(translate);

    // Draw districts
    context.strokeStyle = districtStroke;
    context.fillStyle = background;//d3.color(background).brighter(1).toString();
    context.beginPath();
    path.context(context)(districts);
    context.fill();
    context.stroke();

    // Title Box
    context.fillStyle = '#000';
    context.globalAlpha = 0.35;
    context.fillRect(0, 0, width, Math.round(grid * 1.5));
    context.globalAlpha = 1.0;

    context.fillStyle = sentenceFill;

    // Title
    var titleText = delegation.name + ' Congressional Delegation';
    context.font = titleFont;
    context.fillText(titleText, leftMargin, grid);
    var titleWidth = context.measureText(titleText).width;

    // Subtitle
    var subtitleText = '(elected 2016)';
    context.font = subtitleFont;
    context.textAlign = 'end';
    context.globalAlpha = 0.35;
    context.fillText(subtitleText, width - leftMargin, grid);
    context.textAlign = 'start';
    context.globalAlpha = 1.0;

    // A Sentence class with methods for writing text
    class Sentence {
      constructor(initialX, initialY, initialFont, highlightColor, newlineGap) {
        this.xPosition = initialX;
        this.xBaseline = initialX;
        this.yPosition = initialY;
        this.style = initialFont;
        this.highlightColor = highlightColor;
        this.newlineGap = newlineGap;
      }

      // Write: a method to incrementally write a sentence onto the Canvas
      write(text, style, highlight, newline) {
        if (style) { this.style = style; }
        context.font = this.style;
        if (newline) {
          this.yPosition += this.newlineGap;
          this.xPosition = this.xBaseline;
        }
        if (highlight) {
          var textFill = context.fillStyle;
          context.fillStyle = this.highlightColor;
          context.globalAlpha = 0.35;
          context.fillRect(this.xPosition - 5, this.yPosition - 32, context.measureText(text).width + 10, 46);
          context.fillStyle = textFill;
          context.globalAlpha = 1.0;
        }

        context.fillText(text, this.xPosition, this.yPosition);

        this.xPosition += context.measureText(text).width;
      }
    }

    // Caveats for uncontested races
    var uncontested = delegation.uncontestedSeats;

    var uncontestedSeats = (uncontested[0] === 0 && uncontested[1] === 0) ? false : true;
    var significantAdvantage = delegation.efficiencyGapSeatsImputation !== 0;

    // Main sentence
    var mainSentenceContent = [
      // First Line
      { t: 'The ', s: sentenceFont, h: false, n: false },
      { t: election.parties[advantageParty].name + ' Party', s: sentenceBoldFont, h: !uncontestedSeats && significantAdvantage, n: false },
      { t: ' had a', s: sentenceFont, h: false, n: false },
      // Second Line
      { t: efficiencyGapPercent + ' efficiency gap advantage*', s: sentenceBoldFont, h: !uncontestedSeats && significantAdvantage, n: true },
      // Third Line
      { t: 'worth ', s: sentenceFont, h: false, n: true },
      { t: Math.abs(delegation.efficiencyGapSeats) + ' extra ' + (delegation.efficiencyGapSeats === 1 ? 'seat' : 'seats'), s: sentenceBoldFont, h: !uncontestedSeats && significantAdvantage, n: false },
      { t: (uncontestedSeats ? ', but some seats' : '.'), s: sentenceFont, h: false, n: false },
      // Possible Fourth Line
      { t: (uncontestedSeats ? 'were left uncontested.**' : ''), s: sentenceFont, h: false, n: true },
    ];

    // Write the context sentence
    var mainSentence = new Sentence(leftMargin, Math.ceil(grid * 2.375), sentenceFont, election.parties[advantageParty].color, 48);
    mainSentenceContent.map(function(phrase) {
      mainSentence.write(phrase.t, phrase.s, phrase.h, phrase.n);
    });


    // Explanation
    var explanationSentenceContent = [
      {
        t: ' * The "efficiency gap" measures how effectively a party\'s votes ',
        s: disclaimerFont, h: false, n: false },
        {
          t: '    are distributed among districts and reveals partisan bias.',
          s: disclaimerFont, h: false, n: true }
    ];

    var explanationSentence = new Sentence(leftMargin * 4, uncontestedSeats ? Math.ceil(grid * 8.5) : height - leftMargin * 0.8, disclaimerFont, annotationColor, 18);
    explanationSentenceContent.map(function(phrase) {
      explanationSentence.write(phrase.t, phrase.s, phrase.h, phrase.n);
    });

    // Disclaimers
    if (uncontestedSeats) {
      var estimateDisclaimerSentenceContent = [
        {
          t: '** This efficiency gap score assumes an opponent would have won',
          s: disclaimerFont, h: false, n: false },
        {
          t: '    25% of the vote in uncontested seats.',
          s: disclaimerFont, h: false, n: true }
      ];

      var estimateDisclaimerSentence = new Sentence(leftMargin * 4, height - leftMargin * 0.8, disclaimerFont, annotationColor, 18);
      estimateDisclaimerSentenceContent.map(function(phrase) {
        estimateDisclaimerSentence.write(phrase.t, phrase.s, phrase.h, phrase.n);
      });
    }

    // Bar graph
    var voteRectangleBaseline = Math.floor(graphOriginY + graphHeight * (1/3)),
        seatRectangleBaseline = Math.ceil(graphOriginY + graphHeight * (2/3));

    var votes = delegation.voteResults,
        seats = delegation.seatResults;

    voteScale = d3.scaleLinear()
      .domain([0, votes[0] + votes[1]])
      .range([0, graphWidth]);

    var seatRectangleMargin = 4,
        seatRectangleWidth = Math.floor(graphWidth / delegation.seats) - seatRectangleMargin;

    seatScale = d3.scaleLinear()
      .domain([1, delegation.seats])
      .range([
        graphOriginX + 2,
        (graphOriginX + graphWidth) - Math.floor((graphWidth / delegation.seats)) + seatRectangleMargin
      ]);

    context.font = annotationFont;

    //// Draw rectangles for votes
    if (votes[0] >= 1) {
      // Left Party
      //// shadow
      context.fillStyle = d3.color(election.parties.left.color).darker(1).toString();
      context.fillRect(graphOriginX + 1, voteRectangleBaseline, voteScale(votes[0]) - 4, rectangleHeight);
      //// highlight
      context.fillStyle = d3.color(election.parties.left.color).brighter(1).toString();
      context.fillRect(graphOriginX + 3, voteRectangleBaseline, voteScale(votes[0]) - 4, rectangleHeight);
      //// fill
      context.fillStyle = election.parties.left.color;
      context.fillRect(graphOriginX + 2, voteRectangleBaseline, voteScale(votes[0]) - 4, rectangleHeight);

      context.fillText(Math.round(votes[0] / (votes[0] + votes[1]) * 100) + '% ' + election.parties.left.name + ' vote', graphOriginX, voteRectangleBaseline - annotationMargin);

    }

    if (votes[1] >= 1) {
      // Right Party
      //// shadow
      context.fillStyle = d3.color(election.parties.right.color).darker(1).toString();
      context.fillRect(graphOriginX + voteScale(votes[0]) + 2, voteRectangleBaseline, voteScale(votes[1]) - 4, rectangleHeight);    //// highlight
      //// highlight
      context.fillStyle = d3.color(election.parties.right.color).brighter(1).toString();
      context.fillRect(graphOriginX + voteScale(votes[0]) + 4, voteRectangleBaseline, voteScale(votes[1]) - 4, rectangleHeight);    //// fill
      //// fill
      context.fillStyle = election.parties.right.color;
      context.fillRect(graphOriginX + voteScale(votes[0]) + 3, voteRectangleBaseline, voteScale(votes[1]) - 4, rectangleHeight);

      context.textAlign = 'end';
      context.fillText(Math.round(votes[1] / (votes[0] + votes[1]) * 100) + '% ' + election.parties.right.name + ' vote', graphOriginX + graphWidth, voteRectangleBaseline - annotationMargin);
      context.textAlign = 'start';
    }

    //// Draw rectangles for seats
    for (var s = 1; s <= delegation.seats; s++) {
      var seatColor = s <= delegation.seatResults[0] ? election.parties.left.color : election.parties.right.color;

      // shadow
      context.fillStyle = d3.color(seatColor).darker(1).toString();
      context.fillRect(seatScale(s) - 1,seatRectangleBaseline, seatRectangleWidth, rectangleHeight);

      // highlight
      context.fillStyle = d3.color(seatColor).brighter(1).toString();
      context.fillRect(seatScale(s) + 1,seatRectangleBaseline, seatRectangleWidth, rectangleHeight);

      // fill
      context.fillStyle = seatColor;
      context.fillRect(seatScale(s), seatRectangleBaseline, seatRectangleWidth, rectangleHeight);
    }

    if (seats[0] >= 1) {
      context.fillStyle = election.parties.left.color;
      context.fillText(seats[0] + ' ' + election.parties.left.name + ' ' + (seats[0] === 1 ? 'seat' : 'seats'), graphOriginX, seatRectangleBaseline - annotationMargin);
    }
    if (seats[1] >= 1) {
      context.fillStyle = election.parties.right.color;
      context.textAlign = 'end';
      context.fillText(seats[1] + ' ' + election.parties.right.name + ' ' + (seats[1] === 1 ? 'seat' : 'seats'), graphOriginX + graphWidth, seatRectangleBaseline - annotationMargin);
      context.textAlign = 'start';
    }


    // Uncontested races
    var uncontestedBaseline = seatRectangleBaseline + rectangleHeight + seatRectangleMargin;

    context.strokeStyle = annotationColor;
    context.fillStyle = annotationColor;
    context.lineWidth = 2;
    context.textAlign = 'center';
    context.font = annotationFont;
    context.textBaseline = 'hanging';
    context.globalAlpha = 0.5;

    if (uncontested[0] >= 1) {
      context.beginPath();
      context.moveTo(seatScale(delegation.seats - uncontested[0] + 1) + seatRectangleWidth / 2, uncontestedBaseline);
      context.lineTo(seatScale(delegation.seats - uncontested[0] + 1) + seatRectangleWidth / 2, uncontestedBaseline + 15);
      context.lineTo(seatScale(delegation.seats) + seatRectangleWidth / 2, uncontestedBaseline + 15);
      context.lineTo(seatScale(delegation.seats) + seatRectangleWidth / 2, uncontestedBaseline);
      context.stroke();
      context.closePath();

      context.fillText('uncontested', seatScale(delegation.seats - (uncontested[0] - 1) / 2) + seatRectangleWidth / 2, uncontestedBaseline + 20);
    };

    if (uncontested[1] >= 1) {
      context.beginPath();
      context.moveTo(seatScale(1) + seatRectangleWidth / 2, uncontestedBaseline);
      context.lineTo(seatScale(1) + seatRectangleWidth / 2, uncontestedBaseline + 15);
      context.lineTo(seatScale(uncontested[1]) + seatRectangleWidth / 2, uncontestedBaseline + 15);
      context.lineTo(seatScale(uncontested[1]) + seatRectangleWidth / 2, uncontestedBaseline);
      context.stroke();
      context.closePath();

      context.fillText('uncontested', seatScale(1 + (uncontested[1] - 1) / 2) + seatRectangleWidth / 2, uncontestedBaseline + 20);
    };
    context.textBaseline = 'alphabetic';
    context.globalAlpha = 1.0;

    // Azavea Logo
    var logo = fs.readFileSync('data_analytics.png');
    var image = new Canvas.Image;
    image.src = logo;
    context.globalAlpha = 0.6;
    context.drawImage(image, leftMargin, height - leftMargin * 1.1);
    context.globalAlpha = 1.0;

    process.stdout.write(delegation.name + ': ' + Math.round(delegation.efficiencyGapImputation * 100) / 100 + '\n');

    // Save image to the output directory
    canvas.pngStream().pipe(fs.createWriteStream(config.outputDirectory + '/' + delegation.name + ".png"));
  }
}
