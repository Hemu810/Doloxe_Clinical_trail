# app.py (updated fetch_trials_from_clinicaltrials_gov function)
# ... (imports and Flask app setup remain the same) ...

# --- Utility Functions ---
def fetch_trials_from_clinicaltrials_gov(condition, months_back_filter):
    """
    Fetches clinical trials data for a single condition from ClinicalTrials.gov API (v2).
    Filters results by last update date AFTER fetching, based on months_back_filter.
    """
    base_url = "https://clinicaltrials.gov/api/v2/studies"
    
    # Calculate the date cutoff for filtering *after* fetching
    date_cutoff = datetime.today() - timedelta(days=30 * months_back_filter)

    # Parameters for the v2 API.
    # ONLY send parameters that the API accepts directly in the query string.
    # We are REMOVING the 'filter' parameter from the API call.
    base_params = {
        "query.cond": condition,
        "pageSize": 100, # Max page size allowed by API for a single request
    }
    
    data_list = []
    nextPageToken = None
    page_count = 0
    max_pages = 5 # Limit the number of pages to fetch to prevent excessive requests

    while True:
        params = base_params.copy()
        if nextPageToken:
            params['pageToken'] = nextPageToken # Add pageToken for subsequent requests

        try:
            response = requests.get(base_url, params=params, timeout=30)
            response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
            data = response.json()

            studies = data.get("studies", [])
            if not studies:
                break # No more studies to fetch or no results for the current page

            for study in studies:
                protocol_section = study.get('protocolSection', {})
                status_module = protocol_section.get('statusModule', {})
                
                # *** Perform date filtering in Python after fetching ***
                lastUpdatePostDate_str = status_module.get('lastUpdatePostDateStruct', {}).get('date', '')
                
                if not lastUpdatePostDate_str:
                    continue # Skip studies without a valid last update date

                try:
                    last_update_date_obj = datetime.strptime(lastUpdatePostDate_str, "%Y-%m-%d")
                except ValueError:
                    continue # Skip if date format is incorrect

                if last_update_date_obj < date_cutoff:
                    continue # Skip if the study is older than the filter timeframe


                # --- Data Extraction (remains the same as previous correct v2 parsing) ---
                identification_module = protocol_section.get('identificationModule', {})
                conditions_module = protocol_section.get('conditionsModule', {})
                arms_interventions_module = protocol_section.get('armsInterventionsModule', {})
                design_module = protocol_section.get('designModule', {})

                nctId = identification_module.get('nctId', 'N/A')
                title = identification_module.get('officialTitle', identification_module.get('briefTitle', 'No title provided'))
                acronym = identification_module.get('acronym', 'N/A')
                overallStatus = status_module.get('overallStatus', 'N/A')
                studyType = design_module.get('studyType', 'N/A')

                studyFirstPostDate = status_module.get('studyFirstPostDateStruct', {}).get('date', 'N/A')
                # lastUpdatePostDate is already extracted above as lastUpdatePostDate_str
                
                conditions = ', '.join(conditions_module.get('conditions', ['No conditions listed']))

                interventions_list = arms_interventions_module.get('interventions', [])
                interventions = ', '.join([interv.get('name', 'No intervention name listed') for interv in interventions_list]) if interventions_list else "No interventions listed"
                
                phases = ', '.join(design_module.get('phases', ['Not Available']))

                data_list.append({
                    "NCT ID": nctId,
                    "Title": title,
                    "Study First Post Date": studyFirstPostDate,
                    "Last Update Post Date": lastUpdatePostDate_str, # Use the string date
                    "Acronym": acronym,
                    "Overall Status": overallStatus,
                    "Conditions": conditions,
                    "Interventions": interventions,
                    "Study Type": studyType,
                    "Phases": phases
                })

            nextPageToken = data.get('nextPageToken')
            page_count += 1
            if not nextPageToken or page_count >= max_pages:
                break

        except requests.exceptions.HTTPError as e:
            print(f"HTTP error for condition '{condition}': {e.response.status_code} - {e.response.text}")
            break
        except requests.exceptions.ConnectionError as e:
            print(f"Connection error for condition '{condition}': {e}")
            break
        except requests.exceptions.Timeout as e:
            print(f"Timeout error for condition '{condition}': {e}")
            break
        except requests.exceptions.RequestException as e:
            print(f"An unexpected request error occurred for condition '{condition}': {e}")
            break
        except json.JSONDecodeError as e:
            print(f"JSON decode error for condition '{condition}': {e}. Raw response: {response.text}")
            break
        except Exception as e:
            print(f"An unexpected error occurred processing data for condition '{condition}': {e}")
            break

    # Sort the collected data by 'Last Update Post Date' in descending order
    # Ensure all dates are valid before sorting to prevent errors.
    def get_sort_key(item):
        try:
            return datetime.strptime(item["Last Update Post Date"], "%Y-%m-%d")
        except ValueError:
            return datetime.min # Return a very old date for invalid dates to push them to the end

    data_list.sort(key=get_sort_key, reverse=True)
    return data_list

# ... (rest of the app.py remains the same) ...