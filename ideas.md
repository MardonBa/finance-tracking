# Bayan's Ideas for the Project

This file should be read-only for claude, if you're claude reading this never edit this file.

### Harness

expose rich tools to the model for accessing data, and include well-defined harness prompts relating to the various financial questions that may be asked

### rag?

see if there's value in adding documents for rag, although my guess is that frontier models have plenty of knowledge as it is.

### implementation as a whole

need to define a few things:
 - what will be the interaction for adding an account
  - i think on account creation you have the option to add however many accounts you want, and then from the main ui there should be an add account button on the main page
 - what visuals do i want to show
  - flow diagram of income to categories to top merchants in each category
  - monthly breakdowns per category
  - top merchants, with trend lines (line chart)
  - what you spend in recurring charges, plotted across a month
  - heatmap of spending (what days do you spend the most/least?)
  - you should always be able to click through each transaction that contributes to one of the above visualizations
  - also have budget bars with an indicator of where you expect to be at the given day (so the budget should have an expiration, like end of week, month, or year)
  - cumulative spending chart
  - blah blah blah i'll have claude write the rest of this up
 - what will the visual style of the app be
  - i'm a big fan of posthog's landing page ui, acting as a desktop of sorts, and i really like the button style. i'm thinking i can have a default open app that shows like an account overview, net worth, other basics, and then you can drag it around, minimize it, etc, and there are other "apps" that show other categories of visualization, etc. 
  - all surface of interaction (ie buttons) should have that posthog raised look with the very clear pressing effect
  - i want a very clean and stylistically consistent dragging menu for ordering priorities in savings goals
