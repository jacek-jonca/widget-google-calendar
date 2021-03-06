/* global gadgets, moment, _ */

var RiseVision = RiseVision || {};
RiseVision.Calendar = {};

RiseVision.Calendar = (function (gadgets) {
  "use strict";

  var params,
    pudTimerID,
    fragment,
    daysNode,
    isLoading = true,
    isExpired = false,
    currentDay,
    prefs = new gadgets.Prefs(),
    utils = RiseVision.Common.Utilities,
    $container = $("#container"),
    $scrollContainer = $("#scrollContainer"),
    viewerPaused = true,
    REFRESH_RATE = 30*60*1000; /* 30 minutes */


  /*
   *  Private Methods
   */
  function getScrollEl() {
    if ( typeof $scrollContainer.data( "plugin_autoScroll" ) !== "undefined" ) {
      return $scrollContainer.data( "plugin_autoScroll" );
    }

    return null;
  }

  function onScrollDone() {
    refresh();
    done();
  }

  function removeAutoscroll() {
    var $scroll = getScrollEl();

    if ( $scroll ) {
      $scroll.pause();
      // remove the "done" event handler before destroying
      $( "#container" ).autoScroll().off( "done", onScrollDone );
      // destroy the auto scroll instance
      $scroll.destroy();
      // remove the applied visibility and opacity styling applied by auto-scroll plugin
      $scrollContainer.find(".page").removeAttr("style");
    }

    $(".error, .page").unwrap();
  }

  function applyAutoScroll() {
    if (!jQuery.contains(document, $scrollContainer[0])) {
      $(".error, .page").wrapAll("<div id=\"scrollContainer\">");
      $scrollContainer = $("#scrollContainer");
      $scrollContainer.width(prefs.getInt("rsW"));
      $scrollContainer.height(prefs.getInt("rsH"));
    }

    if ( !getScrollEl() ) {
      $scrollContainer.autoScroll( params.scroll ).on( "done", onScrollDone );
    }
  }

  function getEventsList() {
    RiseVision.Calendar.Provider.getEventsList(params, {
      "success": addEvents,
      "error": function(reason) {
        if (reason && reason.result && reason.result.error) {
          var errorMessage = JSON.stringify(reason.result);

          logEvent( {
            "event": "error",
            "event_details": errorMessage
          } );

          // Network error. Retry later.
          if (reason.result.error.code && reason.result.error.code === -1) {
            startRefreshTimer();
          }
          else {
            $(".error").show();
          }
        }

        if (isLoading) {
          isLoading = false;
          ready();
        }
      }
    });
  }

  function addEvents(resp, timeMin, timeMax) {
    var i,
      length,
      currentEvents,
      calendarDay,
      calendarDays = [],
      dayFragment,
      events = resp.result.items;

    $("#days").empty();

    if (events.length > 0) {
      var start, end, newEvent, newEvents = [], newEnd,
        range = moment().range(timeMin, timeMax);

      // Check if there are any events that span multiple days.
      for (i = events.length - 1; i >= 0; i--) {
        // Single event or multi-day event that is not All Day.
        if (events[i].start.dateTime) {
          start = moment(events[i].start.dateTime);
        }
        // All day event that may or may not span multiple days.
        else {
          start = moment(events[i].start.date);
        }

        // Single event or multi-day event that is not All Day.
        if (events[i].end.dateTime) {
          end = moment(events[i].end.dateTime);

          // If the start and end dates are the same, this is not a multi-day event.
          if (start.isSame(end, "day")) {
            continue;
          }
        }
        // All day event that may or may not span multiple days.
        else {
          end = moment(events[i].end.date);
        }

        // Ignore any events falling on days that started before timeMin.
        if (moment(start).isBefore(timeMin)) {
          start = moment(timeMin).hour(start.hour()).minute(start.minute()).second(start.second());
        }

        /* Create separate events for a multi-day event so that they will be
           displayed for every day on which they take place. */
        while (range.contains(start) && (start.isBefore(end) || start.isSame(end))) {
          newEvent = {};
          newEvent.start = {};
          newEvent.end = {};
          newEvent.summary = events[i].summary;
          newEvent.description = events[i].description;
          newEvent.location = events[i].location;
          newEnd = moment(start).hour(end.hour()).minute(end.minute()).second(end.second()).format();

          // Events than span multiple days will not show times.
          newEvent.start.date = start.format();
          newEvent.end.date = newEnd;

          newEvents.push(newEvent);
          start.add(1, "days");
        }

        // Now remove the original event.
        events.splice(i, 1);
      }

      // Add the new events.
      events.push.apply(events, newEvents);

      // Sort the events by startTime since multi-day events were added to the end.
      events =  _.sortBy(events, function(event) {
        if (event.start.dateTime) {
          return new Date(event.start.dateTime).getTime();
        }
        else {
          return new Date(event.start.date).getTime();
        }
      });

      while (events.length > 0) {
        if (events[0].start.dateTime) {
          currentDay = moment(events[0].start.dateTime);
        }
        else {
          currentDay = moment(events[0].start.date);
        }

        // Get all events for the current day.
        currentEvents = _.filter(events, getCurrentEvents);

        // Don't show events that have completed. Only applicable for today's events.
        if (params.showCompleted !== undefined && !params.showCompleted && (currentDay.diff(moment(), "days") === 0)) {
          currentEvents = _.filter(currentEvents, removeCompletedEvents);
        }

        if (currentEvents.length > 0) {
          // Create RiseVision.Calendar.Day object and set events for it.
          calendarDay = new RiseVision.Calendar.Day(params);
          calendarDay.setEvents(currentEvents);
          calendarDays.push(calendarDay);
        }

        // Remove all events for the current day from the remaining events.
        events = _.filter(events, removeCurrentEvents);
      }
    }

    // Clone the UI for each day.
    dayFragment = document.createDocumentFragment();

    for (i = 0, length = calendarDays.length; i < length; i++) {
      dayFragment.appendChild(fragment.cloneNode(true));
    }

    if (daysNode) {
      daysNode.appendChild(dayFragment);
    }

    // Add events for each day.
    for (i = 0, length = calendarDays.length; i < length; i++) {
      calendarDays[i].addDay(i);
    }

    startRefreshTimer();
    removeAutoscroll();
    applyAutoScroll();

    $(".error").hide();

    if ( isLoading ) {
      isLoading = false;
      ready();
    } else {
      if (!viewerPaused) {
        play();
      }
    }
  }

  function getCurrentEvents(event) {
    if (event.start.dateTime) {
      return moment(event.start.dateTime).isSame(currentDay, "day");
    }
    else {
      return moment(event.start.date).isSame(currentDay, "day");
    }
  }

  function removeCurrentEvents(event) {
    if (event.start.dateTime) {
      return !moment(event.start.dateTime).isSame(currentDay, "day");
    }
    else {
      return !moment(event.start.date).isSame(currentDay, "day");
    }
  }

  function removeCompletedEvents(event) {
    if (event.end && event.end.dateTime) {
      return !moment().isAfter(moment(event.end.dateTime));
    }
    else {
      return true;
    }
  }

  // Check if there is enough content to scroll.
  function canScroll() {
    var $scroll = getScrollEl();

    return params.scroll.by !== "none" && $scroll && $scroll.canScroll();
  }

  // If there is not enough content to scroll, use the PUD Failover setting as the trigger
  // for sending "done".
  function startPUDTimer() {
    var delay;

    if ((params.scroll.pud === undefined) || (params.scroll.pud < 1)) {
      delay = 10000;
    }
    else {
      delay = params.scroll.pud * 1000;
    }

    pudTimerID = setTimeout(function() {
      refresh();
      done();
    }, delay);
  }

  function stopPUDTimer() {
    if (pudTimerID) {
      clearTimeout(pudTimerID);
      pudTimerID = null;
    }
  }

  function startRefreshTimer() {
    setTimeout(function() {
      isExpired = true;

      // Refresh immediately if the content is not scrolling.
      if (!canScroll()) {
        refresh();
      }
    }, REFRESH_RATE);
  }

  function refresh() {
    if (isExpired) {
      isExpired = false;
      stopPUDTimer();
      getEventsList();
    }
  }

  function ready() {
    gadgets.rpc.call("", "rsevent_ready", null, prefs.getString("id"), true,
      true, true, true, true);
  }

  function done() {
    gadgets.rpc.call("", "rsevent_done", null, prefs.getString("id"));
  }

  function logEvent( params ) {
    RiseVision.Common.LoggerUtils.logEvent( "calendar_events", params );
  }

  /*
   *  Public Methods
   */
  function configure(names, values) {
    var companyId = "",
        displayId = "";

    if ( Array.isArray( names ) && names.length > 0 && Array.isArray( values ) && values.length > 0 ) {
        // company id
        if ( names[ 0 ] === "companyId" ) {
          companyId = values[ 0 ];
        }

        // display id
        if ( names[ 1 ] === "displayId" ) {
          if ( values[ 1 ] ) {
            displayId = values[ 1 ];
          } else {
            displayId = "preview";
          }
        }
        RiseVision.Common.LoggerUtils.setIds( companyId, displayId );

        if ( names[ 2 ] === "additionalParams" ) {
          params = JSON.parse( values[ 2 ] );

          setAdditionalParams( params );
        }
      }
    }

    function setAdditionalParams( params ) {
      // Load fonts.
      var fontSettings = [
        {
          "class": "date",
          "fontStyle": params.dateFont
        },
        {
          "class": "time",
          "fontStyle": params.timeFont
        },
        {
          "class": "summary",
          "fontStyle": params.titleFont
        },
        {
          "class": "location",
          "fontStyle": params.locationFont
        },
        {
          "class": "description",
          "fontStyle": params.descriptionFont
        }
      ];

      utils.loadFonts(fontSettings);

      // Store the base HTML in a DocumentFragment so that it can be used later.
      fragment = document.createDocumentFragment();
      daysNode = document.getElementById("days");

      // Add the HTML to the fragment.
      if (daysNode) {
        while (daysNode.firstChild) {
          fragment.appendChild(daysNode.firstChild);
        }
      }

      $container.width(prefs.getInt("rsW"));
      $container.height(prefs.getInt("rsH"));

      $scrollContainer.width(prefs.getInt("rsW"));
      $scrollContainer.height(prefs.getInt("rsH"));

      getEventsList();

      logEvent( {
        "event": "configuration",
        "calendar_id": params.calendar || "no calendar id"
      } );
    }


  function play() {
    var $scroll = getScrollEl();

    viewerPaused = false;

    if ( $scroll && canScroll() ) {
      $scroll.play();
    }
    else {
      startPUDTimer();
    }
  }

  function pause() {
    var $scroll = getScrollEl();

    viewerPaused = true;

    if ( $scroll && canScroll() ) {
      $scroll.pause();
    }

    // Clear the PUD timer if the playlist item is not set to PUD.
    stopPUDTimer();
  }

  function stop() {
    // Ideally, the Widget should destroy itself, but unable to do so right now
    // since `stop` is being called by RVA instead of `pause` when it's the only
    // item in a Playlist.
    pause();
  }

  return {
    logEvent           : logEvent,
    configure          : configure,
    setAdditionalParams: setAdditionalParams,
    play               : play,
    pause              : pause,
    stop               : stop
  };
})(gadgets);
